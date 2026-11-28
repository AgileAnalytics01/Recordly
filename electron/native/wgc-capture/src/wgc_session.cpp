#include "wgc_session.h"

#include <windows.graphics.capture.interop.h>
#include <Windows.Graphics.Capture.h>
#include <d3d11_4.h>
#include <inspectable.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>

#include <dwmapi.h>

#include <algorithm>
#include <utility>
#include <iostream>
#include <chrono>

// IDirect3DDxgiInterfaceAccess is a COM interface for getting the DXGI interface
// from a WinRT IDirect3DSurface
MIDL_INTERFACE("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")
IDirect3DDxgiInterfaceAccess : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE GetInterface(REFIID iid, void** p) = 0;
};

// Convert ID3D11Device → IDirect3DDevice (WinRT interop)
extern "C" {
    HRESULT __stdcall CreateDirect3D11DeviceFromDXGIDevice(
        IDXGIDevice* dxgiDevice,
        IInspectable** graphicsDevice);
}

static int normalizeFramePoolExtent(int value) {
    int normalized = value < 2 ? 2 : value;
    if ((normalized % 2) != 0) ++normalized;
    return normalized;
}

// Frames the pool can hold while the consumer is busy; 2 starves easily at high frame rates.
static constexpr int kFramePoolBuffers = 4;

// How often the window is checked for open popups, and how long the monitor capture that
// supplies their pixels keeps running after the last one closes.
static constexpr auto kPopupPollInterval = std::chrono::milliseconds(25);
static constexpr auto kPopupLinger = std::chrono::seconds(3);

static RECT visibleWindowBounds(HWND hwnd) {
    RECT rect{};
    // Matches the area Windows Graphics Capture records: the window without its invisible
    // resize borders.
    if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect)))) {
        GetWindowRect(hwnd, &rect);
    }
    return rect;
}

static bool isCloaked(HWND hwnd) {
    DWORD cloaked = 0;
    return SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) &&
           cloaked != 0;
}

struct PopupSearch {
    HWND target = nullptr;
    DWORD processId = 0;
    RECT targetBounds{};
    std::vector<RECT> rects;
};

static BOOL CALLBACK collectPopup(HWND hwnd, LPARAM param) {
    auto* search = reinterpret_cast<PopupSearch*>(param);
    // EnumWindows walks the Z order from the top: only windows above the target cover it.
    if (hwnd == search->target) return FALSE;
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || isCloaked(hwnd)) return TRUE;

    DWORD processId = 0;
    GetWindowThreadProcessId(hwnd, &processId);
    if (processId != search->processId) return TRUE;

    // Dropdowns, menus and tooltips are captionless, non-resizable popups. This leaves out
    // the app's other ordinary windows, which are not part of the recorded window.
    const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    const LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    if (!(style & WS_POPUP) || (style & WS_CAPTION) == WS_CAPTION || (style & WS_THICKFRAME) ||
        (exStyle & WS_EX_APPWINDOW)) {
        return TRUE;
    }

    RECT popup = visibleWindowBounds(hwnd);
    RECT overlap{};
    if (IntersectRect(&overlap, &popup, &search->targetBounds)) {
        search->rects.push_back(overlap);
    }
    return TRUE;
}

WgcSession::WgcSession() {}

WgcSession::~WgcSession() {
    stopCapture();
}

bool WgcSession::createD3DDevice() {
    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };

    HRESULT hr = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        nullptr,
        &d3dContext_);

    if (FAILED(hr)) {
        std::cerr << "ERROR: D3D11CreateDevice failed: 0x" << std::hex << hr << std::dec << std::endl;
        return false;
    }

    // The capture callback and the encoder's readback worker share this immediate context.
    ComPtr<ID3D11Multithread> multithread;
    hr = d3dContext_.As(&multithread);
    if (FAILED(hr) || !multithread) {
        std::cerr << "ERROR: Failed to query ID3D11Multithread: 0x" << std::hex << hr << std::dec << std::endl;
        return false;
    }
    multithread->SetMultithreadProtected(TRUE);

    // Report which GPU performs the capture; on hybrid laptops this matters for performance.
    ComPtr<IDXGIDevice> dxgiDevice;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC adapterDesc{};
    if (SUCCEEDED(d3dDevice_.As(&dxgiDevice)) && SUCCEEDED(dxgiDevice->GetAdapter(&adapter)) &&
        SUCCEEDED(adapter->GetDesc(&adapterDesc))) {
        char name[256]{};
        WideCharToMultiByte(CP_UTF8, 0, adapterDesc.Description, -1, name, sizeof(name) - 1, nullptr, nullptr);
        std::cerr << "Capture adapter: " << name << std::endl;
    }

    return true;
}

winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice WgcSession::createWinRTDevice() {
    ComPtr<IDXGIDevice> dxgiDevice;
    HRESULT hr = d3dDevice_.As(&dxgiDevice);
    if (FAILED(hr)) return nullptr;

    winrt::com_ptr<IInspectable> inspectable;
    hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectable.put());
    if (FAILED(hr)) return nullptr;

    return inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
}

winrt::Windows::Graphics::Capture::GraphicsCaptureItem WgcSession::createCaptureItemForMonitor(HMONITOR monitor) {
    auto factory = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();

    auto interop = factory.as<IGraphicsCaptureItemInterop>();

    winrt::Windows::Graphics::Capture::GraphicsCaptureItem item{nullptr};
    HRESULT hr = interop->CreateForMonitor(
        monitor,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        winrt::put_abi(item));

    if (FAILED(hr)) {
        std::cerr << "ERROR: CreateForMonitor failed: 0x" << std::hex << hr << std::endl;
        return nullptr;
    }

    return item;
}

bool WgcSession::initializeWithItem(int fps) {
    if (!captureItem_) return false;

    auto size = captureItem_.Size();
    captureWidth_ = size.Width;
    captureHeight_ = size.Height;
    framePoolWidth_ = normalizeFramePoolExtent(size.Width);
    framePoolHeight_ = normalizeFramePoolExtent(size.Height);

    framePool_ = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        kFramePoolBuffers,
        {framePoolWidth_, framePoolHeight_});

    session_ = framePool_.CreateCaptureSession(captureItem_);

    session_.IsCursorCaptureEnabled(false);

    // IsBorderRequired is only available on Windows 11+ (build 22000). propagating an hresult_error results in Native Windows capture failure
    try {
        session_.IsBorderRequired(false);
    } catch (winrt::hresult_error const&) {
    }

    return true;
}

void WgcSession::recreateFramePoolIfNeeded(
    winrt::Windows::Graphics::SizeInt32 const& contentSize) {
    if (!capturing_ || !framePool_) return;

    const int normalizedWidth = normalizeFramePoolExtent(contentSize.Width);
    const int normalizedHeight = normalizeFramePoolExtent(contentSize.Height);
    if (normalizedWidth == framePoolWidth_ && normalizedHeight == framePoolHeight_) {
        return;
    }

    winrt::Windows::Graphics::SizeInt32 normalizedSize{
        normalizedWidth,
        normalizedHeight,
    };

    try {
        framePool_.Recreate(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            kFramePoolBuffers,
            normalizedSize);
        framePoolWidth_ = normalizedWidth;
        framePoolHeight_ = normalizedHeight;
        std::cerr << "INFO: Recreated WGC frame pool for resized content "
                  << framePoolWidth_ << "x" << framePoolHeight_ << std::endl;
    } catch (winrt::hresult_error const& e) {
        fatalError_ = true;
        capturing_ = false;
        std::cerr << "ERROR: Failed to recreate WGC frame pool after resize: 0x"
                  << std::hex << e.code() << std::dec << std::endl;
    }

}

bool WgcSession::initialize(HMONITOR monitor, int fps) {
    fps_ = fps > 0 ? fps : 60;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps_);
}

bool WgcSession::initialize(HWND hwnd, int fps) {
    fps_ = fps > 0 ? fps : 60;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    auto factory = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();
    auto interop = factory.as<IGraphicsCaptureItemInterop>();
    const HRESULT result = interop->CreateForWindow(
        hwnd,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        winrt::put_abi(captureItem_));
    if (FAILED(result)) {
        std::cerr << "ERROR: CreateForWindow failed: 0x" << std::hex << result << std::dec << std::endl;
        return false;
    }
    windowHandle_ = hwnd;
    return initializeWithItem(fps_);
}

void WgcSession::setFrameCallback(FrameCallback callback, std::function<bool()> isPaused) {
    frameCallback_ = std::move(callback);
    isPaused_ = std::move(isPaused);
}

bool WgcSession::startCapture() {
    if (!session_ || !framePool_) return false;

    capturing_ = true;
    fatalError_ = false;
    nextFrameDueHns_ = 0;
    hasNextFrameDue_ = false;

    if (windowHandle_) {
        itemClosedRevoker_ = captureItem_.Closed(
            winrt::auto_revoke,
            [this](auto const&, auto const&) { fatalError_ = true; });
    }
    frameArrivedRevoker_ = framePool_.FrameArrived(
        winrt::auto_revoke,
        [this](auto const& sender, auto const& args) {
            onFrameArrived(sender, args);
        });

    session_.StartCapture();

    if (windowHandle_) {
        popupWatcherRunning_ = true;
        popupWatcher_ = std::thread([this] { watchPopups(); });
    }
    return true;
}

void WgcSession::stopCapture() {
    capturing_ = false;

    popupWatcherRunning_ = false;
    if (popupWatcher_.joinable()) popupWatcher_.join();
    stopPopupCapture();

    itemClosedRevoker_.revoke();
    frameArrivedRevoker_.revoke();

    // Wait for the active reader, then release the lock before WinRT closes the frame pool.
    {
        std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    }
    if (session_) {
        session_.Close();
        session_ = nullptr;
    }
    if (framePool_) {
        framePool_.Close();
        framePool_ = nullptr;
    }
}

void WgcSession::onFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
    winrt::Windows::Foundation::IInspectable const&) {
    if (!capturing_) return;
    std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    const bool cachePausedWindowFrame = windowHandle_ && isPaused_ && isPaused_();
    readFrame(sender, cachePausedWindowFrame);
}

void WgcSession::resumeAfterPendingFrames(int64_t resumeTimestampHns, const std::function<void()>& resume) {
    std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    if (windowHandle_) {
        // Let any callback already in flight finish and drain the frames already queued
        // by WGC before switching the timestamp and frame writer back to recording.
        for (int count = 0; count < kFramePoolBuffers; ++count) {
            if (!readFrame(framePool_, true)) break;
        }
    }
    nextFrameDueHns_ = 0;
    hasNextFrameDue_ = false;
    resumeTimestampHns_ = resumeTimestampHns;
    resume();
}

bool WgcSession::readFrame(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
    bool skipFrameRateLimit) {
    if (!capturing_ || fatalError_) return false;

    auto frame = pool.TryGetNextFrame();
    if (!frame) return false;
    const auto contentSize = frame.ContentSize();

    auto timestamp = frame.SystemRelativeTime();
    int64_t frameTimeHns = std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(timestamp).count();

    if (frameTimeHns < resumeTimestampHns_) {
        frame.Close();
        recreateFramePoolIfNeeded(contentSize);
        return true;
    }

    // Paused window frames replace the cached image instead of reaching the encoder.
    if (!admitFrameTime(frameTimeHns, skipFrameRateLimit)) {
        frame.Close();
        recreateFramePoolIfNeeded(contentSize);
        return true;
    }

    if (auto access = frame.Surface().try_as<IDirect3DDxgiInterfaceAccess>()) {
        ComPtr<ID3D11Texture2D> texture;
        const HRESULT result = access->GetInterface(IID_PPV_ARGS(&texture));
        if (SUCCEEDED(result) && texture && frameCallback_) {
            if (windowHandle_) {
                deliverWindowFrame(texture.Get(), contentSize.Width, contentSize.Height, frameTimeHns);
            } else {
                frameCallback_(texture.Get(), contentSize.Width, contentSize.Height, frameTimeHns);
            }
        }
    }

    frame.Close();
    recreateFramePoolIfNeeded(contentSize);
    return true;
}

bool WgcSession::admitFrameTime(int64_t frameTimeHns, bool skipFrameRateLimit) {
    if (skipFrameRateLimit) return true;

    // Frame rate limiting against a fixed schedule. The display can refresh much faster than
    // the recording rate (e.g. 165 Hz); a plain "minimum gap" test would let through every
    // second refresh (~82 fps) and make the encoder do far more work than requested.
    if (!hasNextFrameDue_) {
        nextFrameDueHns_ = frameTimeHns;
        hasNextFrameDue_ = true;
    }
    if (frameTimeHns + frameIntervalHns_ / 2 < nextFrameDueHns_) {
        return false;
    }
    nextFrameDueHns_ += frameIntervalHns_;
    // After a pause or an idle screen the schedule is stale; restart it from this frame.
    if (nextFrameDueHns_ < frameTimeHns) nextFrameDueHns_ = frameTimeHns + frameIntervalHns_;
    return true;
}

bool WgcSession::copyToCache(ID3D11Texture2D* source, ComPtr<ID3D11Texture2D>& cache) {
    D3D11_TEXTURE2D_DESC sourceDesc{};
    source->GetDesc(&sourceDesc);
    D3D11_TEXTURE2D_DESC cacheDesc{};
    if (cache) cache->GetDesc(&cacheDesc);
    if (!cache || cacheDesc.Width != sourceDesc.Width || cacheDesc.Height != sourceDesc.Height ||
        cacheDesc.Format != sourceDesc.Format) {
        sourceDesc.Usage = D3D11_USAGE_DEFAULT;
        sourceDesc.BindFlags = 0;
        sourceDesc.CPUAccessFlags = 0;
        sourceDesc.MiscFlags = 0;
        cache.Reset();
        if (FAILED(d3dDevice_->CreateTexture2D(&sourceDesc, nullptr, cache.GetAddressOf()))) {
            cache.Reset();
            return false;
        }
    }
    d3dContext_->CopyResource(cache.Get(), source);
    return true;
}

std::vector<RECT> WgcSession::popupRectsOverWindow() const {
    PopupSearch search;
    search.target = windowHandle_;
    GetWindowThreadProcessId(windowHandle_, &search.processId);
    search.targetBounds = visibleWindowBounds(windowHandle_);
    if (search.processId == 0) return {};
    EnumWindows(collectPopup, reinterpret_cast<LPARAM>(&search));
    return std::move(search.rects);
}

void WgcSession::deliverWindowFrame(ID3D11Texture2D* texture, int contentWidth, int contentHeight,
                                    int64_t frameTimeHns) {
    // Keep the newest window image so popup changes can be recorded while the window is idle.
    if (copyToCache(texture, windowCache_)) {
        windowCacheWidth_ = contentWidth;
        windowCacheHeight_ = contentHeight;
    } else {
        windowCache_.Reset();
    }

    // A popup frame can already have gone out with a later timestamp.
    if (frameTimeHns <= lastDeliveredHns_) return;

    std::vector<RECT> popups;
    if (popupPool_ && monitorCache_ && windowCache_) popups = popupRectsOverWindow();
    if (popups.empty()) {
        lastFrameHadPopups_ = false;
        lastDeliveredHns_ = frameTimeHns;
        frameCallback_(texture, contentWidth, contentHeight, frameTimeHns);
        return;
    }
    deliverComposite(popups, frameTimeHns);
}

void WgcSession::deliverComposite(const std::vector<RECT>& popups, int64_t frameTimeHns) {
    if (!windowCache_) return;
    ID3D11Texture2D* output = windowCache_.Get();

    if (!popups.empty() && monitorCache_ && copyToCache(windowCache_.Get(), composite_)) {
        output = composite_.Get();
        const RECT window = visibleWindowBounds(windowHandle_);
        for (const RECT& popup : popups) {
            // Clip to what both captures actually hold.
            const LONG left = (std::max)({popup.left, window.left, popupMonitorRect_.left});
            const LONG top = (std::max)({popup.top, window.top, popupMonitorRect_.top});
            const LONG right = (std::min)({popup.right, window.left + windowCacheWidth_,
                                           popupMonitorRect_.left + monitorCacheWidth_});
            const LONG bottom = (std::min)({popup.bottom, window.top + windowCacheHeight_,
                                            popupMonitorRect_.top + monitorCacheHeight_});
            if (right <= left || bottom <= top) continue;

            D3D11_BOX source{};
            source.left = static_cast<UINT>(left - popupMonitorRect_.left);
            source.top = static_cast<UINT>(top - popupMonitorRect_.top);
            source.right = static_cast<UINT>(right - popupMonitorRect_.left);
            source.bottom = static_cast<UINT>(bottom - popupMonitorRect_.top);
            source.front = 0;
            source.back = 1;
            d3dContext_->CopySubresourceRegion(
                output, 0,
                static_cast<UINT>(left - window.left), static_cast<UINT>(top - window.top), 0,
                monitorCache_.Get(), 0, &source);
        }
    }

    lastFrameHadPopups_ = output == composite_.Get();
    lastDeliveredHns_ = frameTimeHns;
    frameCallback_(output, windowCacheWidth_, windowCacheHeight_, frameTimeHns);
}

void WgcSession::onPopupFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender) {
    if (!capturing_) return;
    std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    // A capture replaced or stopped by the watcher may still deliver one late frame.
    if (!capturing_ || fatalError_ || !popupPool_ || sender != popupPool_) return;

    auto frame = sender.TryGetNextFrame();
    if (!frame) return;
    while (auto newer = sender.TryGetNextFrame()) {
        frame.Close();
        frame = newer;
    }

    const auto contentSize = frame.ContentSize();
    const int64_t frameTimeHns = std::chrono::duration_cast<
        std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(frame.SystemRelativeTime()).count();

    // Nothing to add, and no popup to remove from the last frame: the window capture covers it.
    std::vector<RECT> popups = popupRectsOverWindow();
    if (popups.empty() && !lastFrameHadPopups_) {
        frame.Close();
        return;
    }

    bool cached = false;
    if (auto access = frame.Surface().try_as<IDirect3DDxgiInterfaceAccess>()) {
        ComPtr<ID3D11Texture2D> texture;
        if (SUCCEEDED(access->GetInterface(IID_PPV_ARGS(&texture))) && texture) {
            cached = copyToCache(texture.Get(), monitorCache_);
        }
    }
    frame.Close();
    if (!cached) {
        monitorCache_.Reset();
        return;
    }
    monitorCacheWidth_ = contentSize.Width;
    monitorCacheHeight_ = contentSize.Height;

    if (!windowCache_ || !frameCallback_) return;
    if (frameTimeHns < resumeTimestampHns_ || frameTimeHns <= lastDeliveredHns_) return;
    const bool paused = isPaused_ && isPaused_();
    if (!admitFrameTime(frameTimeHns, paused)) return;
    deliverComposite(popups, frameTimeHns);
}

void WgcSession::startPopupCapture(HMONITOR monitor, const RECT& monitorRect) {
    stopPopupCapture();
    if (popupCaptureFailed_) return;

    try {
        auto item = createCaptureItemForMonitor(monitor);
        if (!item) {
            popupCaptureFailed_ = true;
            return;
        }
        auto size = item.Size();
        auto pool = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            {normalizeFramePoolExtent(size.Width), normalizeFramePoolExtent(size.Height)});
        auto session = pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled(false);
        try {
            session.IsBorderRequired(false);
        } catch (winrt::hresult_error const&) {
        }

        {
            std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
            popupItem_ = item;
            popupPool_ = pool;
            popupSession_ = session;
            popupMonitor_ = monitor;
            popupMonitorRect_ = monitorRect;
            monitorCache_.Reset();
        }
        popupFrameRevoker_ = pool.FrameArrived(
            winrt::auto_revoke,
            [this](auto const& sender, auto const&) { onPopupFrameArrived(sender); });
        session.StartCapture();
    } catch (winrt::hresult_error const& e) {
        // The window recording carries on; only popups over it are left out.
        std::cerr << "WARNING: Could not capture popups over the window: 0x"
                  << std::hex << e.code() << std::dec << std::endl;
        popupCaptureFailed_ = true;
        stopPopupCapture();
    }
}

void WgcSession::stopPopupCapture() {
    popupFrameRevoker_.revoke();

    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool pool{nullptr};
    {
        std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
        session = std::exchange(popupSession_, nullptr);
        pool = std::exchange(popupPool_, nullptr);
        popupItem_ = nullptr;
        popupMonitor_ = nullptr;
        monitorCache_.Reset();
    }
    try {
        if (session) session.Close();
        if (pool) pool.Close();
    } catch (winrt::hresult_error const&) {
    }
}

void WgcSession::watchPopups() {
    // Popups are rare, so the monitor capture only runs while one is open (plus a short
    // linger to record it closing). That keeps the cost off ordinary window recordings.
    auto lastPopupSeen = std::chrono::steady_clock::time_point{};
    while (popupWatcherRunning_) {
        std::this_thread::sleep_for(kPopupPollInterval);
        if (!popupWatcherRunning_ || popupCaptureFailed_) continue;
        if (!IsWindow(windowHandle_)) break;

        const auto now = std::chrono::steady_clock::now();
        if (!popupRectsOverWindow().empty()) {
            lastPopupSeen = now;
            HMONITOR monitor = MonitorFromWindow(windowHandle_, MONITOR_DEFAULTTONEAREST);
            MONITORINFO info{};
            info.cbSize = sizeof(info);
            if (!monitor || !GetMonitorInfoW(monitor, &info)) continue;
            if (!popupPool_ || monitor != popupMonitor_ ||
                !EqualRect(&info.rcMonitor, &popupMonitorRect_)) {
                startPopupCapture(monitor, info.rcMonitor);
            }
        } else if (popupPool_ && now - lastPopupSeen > kPopupLinger) {
            stopPopupCapture();
        }
    }
}
