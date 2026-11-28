#pragma once

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <functional>
#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <thread>
#include <future>
#include <vector>

using Microsoft::WRL::ComPtr;

class WgcSession {
public:
    using FrameCallback = std::function<void(ID3D11Texture2D*, int contentWidth, int contentHeight,
                                             int64_t timestampHns)>;

    WgcSession();
    ~WgcSession();

    bool initialize(HMONITOR monitor, int fps);
    bool initialize(HWND hwnd, int fps);
    void setFrameCallback(FrameCallback callback, std::function<bool()> isPaused);
    bool startCapture();
    void stopCapture();
    void resumeAfterPendingFrames(int64_t resumeTimestampHns, const std::function<void()>& resume);
    bool hasFatalError() const {
        return fatalError_.load() || (windowHandle_ && !IsWindow(windowHandle_));
    }

    int captureWidth() const { return captureWidth_; }
    int captureHeight() const { return captureHeight_; }
    ID3D11Device* device() const { return d3dDevice_.Get(); }
    ID3D11DeviceContext* context() const { return d3dContext_.Get(); }

private:
    ComPtr<ID3D11Device> d3dDevice_;
    ComPtr<ID3D11DeviceContext> d3dContext_;
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice winrtDevice_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem captureItem_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool framePool_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem::Closed_revoker itemClosedRevoker_;
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrivedRevoker_;

    FrameCallback frameCallback_;
    std::function<bool()> isPaused_;
    std::mutex frameDeliveryMutex_;
    std::atomic<bool> capturing_{false};
    std::atomic<bool> fatalError_{false};
    int fps_ = 60;
    int captureWidth_ = 0;
    int captureHeight_ = 0;
    int framePoolWidth_ = 0;
    int framePoolHeight_ = 0;
    int64_t frameIntervalHns_ = 0;
    int64_t nextFrameDueHns_ = 0;
    bool hasNextFrameDue_ = false;
    int64_t resumeTimestampHns_ = 0;
    HWND windowHandle_ = nullptr;

    // Window capture only sees the window itself. Dropdown lists, context menus and tooltips
    // are separate popup windows, so while one is open over the window a monitor capture
    // runs alongside and its pixels are copied into the window frame.
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem popupItem_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool popupPool_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession popupSession_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::FrameArrived_revoker popupFrameRevoker_;
    HMONITOR popupMonitor_ = nullptr;
    RECT popupMonitorRect_{};
    std::thread popupWatcher_;
    std::atomic<bool> popupWatcherRunning_{false};
    std::atomic<DWORD> popupWatcherThreadId_{0};
    bool popupCaptureFailed_ = false;
    bool popupsOpen_ = false;
    std::chrono::steady_clock::time_point popupLingerDeadline_{};
    int lastWindowContentWidth_ = 0;
    int lastWindowContentHeight_ = 0;
    ComPtr<ID3D11Texture2D> windowCache_;
    int windowCacheWidth_ = 0;
    int windowCacheHeight_ = 0;
    ComPtr<ID3D11Texture2D> monitorCache_;
    int monitorCacheWidth_ = 0;
    int monitorCacheHeight_ = 0;
    ComPtr<ID3D11Texture2D> composite_;
    bool lastFrameHadPopups_ = false;
    int64_t lastDeliveredHns_ = 0;

    bool createD3DDevice();
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice createWinRTDevice();
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem createCaptureItemForMonitor(HMONITOR monitor);
    bool initializeWithItem(int fps);
    void recreateFramePoolIfNeeded(
        winrt::Windows::Graphics::SizeInt32 const& contentSize);
    void onFrameArrived(
        winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
        winrt::Windows::Foundation::IInspectable const& args);
    bool readFrame(
        winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
        bool skipFrameRateLimit);
    bool admitFrameTime(int64_t frameTimeHns, bool skipFrameRateLimit);
    bool copyToCache(ID3D11Texture2D* source, ComPtr<ID3D11Texture2D>& cache);
    void deliverWindowFrame(ID3D11Texture2D* texture, int contentWidth, int contentHeight,
                            int64_t frameTimeHns);
    void deliverComposite(const std::vector<RECT>& popups, int64_t frameTimeHns);
    std::vector<RECT> popupRectsOverWindow() const;
    bool seedWindowCacheFromMonitor();
    void watchPopups(std::promise<void>* ready);
    friend void CALLBACK onPopupWinEvent(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD);
    void updatePopupCapture();
    void startPopupCapture(HMONITOR monitor, const RECT& monitorRect);
    void stopPopupCapture();
    void onPopupFrameArrived(
        winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender);
};
