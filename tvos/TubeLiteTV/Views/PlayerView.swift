import SwiftUI
import AVKit

/// Fullscreen AVPlayer. Presented from WatchView when playing.
public struct PlayerView: View {
    public let videoId: String
    public let onOpenAccount: () -> Void
    public let onDismiss: () -> Void
    
    @State private var player: AVPlayer? = nil
    @State private var resourceLoader: TubeLiteResourceLoader? = nil
    @State private var timeObserverToken: Any? = nil
    @State private var itemStatusObserver: NSKeyValueObservation? = nil
    @State private var timeControlObserver: NSKeyValueObservation? = nil
    @State private var failedObserver: Any? = nil
    @State private var errorLogObserver: Any? = nil
    
    @State private var sponsorSegments: [TubeLiteGatewayClient.SponsorSegment] = []
    @State private var isLoadingStream: Bool = true
    @State private var isBuffering: Bool = true
    @State private var loadingStage: String = "Loading…"
    @State private var streamError: String? = nil
    @State private var requiresSignIn: Bool = false
    @State private var showSponsorToast: Bool = false
    
    @State private var diagnostics: TubeLiteGatewayClient.PlaybackDiagnostics? = nil
    @State private var avPlayerErrorLog: String? = nil
    @State private var showDiagnosticsHUD: Bool = false
    
    private enum ErrorAction: Hashable {
        case tryAgain, signIn, diagnostics, back
    }
    
    @FocusState private var focusedErrorAction: ErrorAction?
    
    public init(
        videoId: String,
        onOpenAccount: @escaping () -> Void = {},
        onDismiss: @escaping () -> Void
    ) {
        self.videoId = videoId
        self.onOpenAccount = onOpenAccount
        self.onDismiss = onDismiss
    }
    
    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            if let player = player, streamError == nil {
                VideoPlayer(player: player) {
                    VStack {
                        if showSponsorToast {
                            Text("Sponsor skipped")
                                .font(.callout.weight(.semibold))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(.ultraThinMaterial, in: Capsule())
                                .padding(.top, 40)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                        Spacer()
                    }
                    .animation(.easeInOut(duration: 0.25), value: showSponsorToast)
                }
                .ignoresSafeArea()
            }
            
            if streamError != nil {
                errorPanel
                    .defaultFocus($focusedErrorAction, .tryAgain)
            } else if isLoadingStream || isBuffering {
                // Always on top so the spinner appears immediately (and during stalls).
                bufferingOverlay
            }
        }
        .onExitCommand { closePlayer() }
        .task(id: videoId) { await setupAndPlay() }
        .onDisappear { teardownPlayer() }
        .onChange(of: streamError) { _, newValue in
            if newValue != nil { focusedErrorAction = .tryAgain }
        }
    }
    
    private var bufferingOverlay: some View {
        ZStack {
            Color.black.opacity(isLoadingStream ? 1 : 0.35)
            VStack(spacing: 14) {
                ProgressView()
                    .scaleEffect(1.4)
                if isLoadingStream {
                    Text(loadingStage)
                        .font(.callout)
                        .foregroundColor(TLTheme.textSecondary)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.15), value: isLoadingStream || isBuffering)
    }
    
    private var errorPanel: some View {
        VStack(spacing: 18) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundColor(TLTheme.warning)
            
            Text("Playback Unavailable")
                .font(.title2.weight(.semibold))
                .foregroundColor(TLTheme.textPrimary)
            
            Text(streamError ?? "Unable to play video.")
                .font(.callout)
                .foregroundColor(TLTheme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 900)
            
            if let avLog = avPlayerErrorLog, !showDiagnosticsHUD {
                Text(avLog)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(TLTheme.warning)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: 1000, alignment: .leading)
                    .padding(16)
                    .background(RoundedRectangle(cornerRadius: 12).fill(TLTheme.surface))
            }
            
            if requiresSignIn {
                Text("Some videos need a signed-in account.")
                    .font(.callout)
                    .foregroundColor(TLTheme.accent)
            }
            
            HStack(spacing: 16) {
                errorButton("Try Again", action: .tryAgain) {
                    Task { await setupAndPlay() }
                }
                if requiresSignIn {
                    errorButton("Sign In", action: .signIn, onOpenAccount)
                }
                if diagnostics != nil {
                    errorButton(showDiagnosticsHUD ? "Hide Info" : "Diagnostics", action: .diagnostics) {
                        showDiagnosticsHUD.toggle()
                    }
                }
                errorButton("Back", action: .back, closePlayer)
            }
            
            if showDiagnosticsHUD, let diag = diagnostics {
                diagnosticsCard(diag)
            }
        }
        .padding(36)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private func errorButton(_ title: String, action: ErrorAction, _ handler: @escaping () -> Void) -> some View {
        Button(title, action: handler)
            .buttonStyle(.borderedProminent)
            .tint(focusedErrorAction == action ? .white : TLTheme.surfaceElevated)
            .focused($focusedErrorAction, equals: action)
    }
    
    private func diagnosticsCard(_ diag: TubeLiteGatewayClient.PlaybackDiagnostics) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Stage: \(diag.failureStage ?? "None")")
                Text("HTTP: \(diag.primaryHttpStatus.map(String.init) ?? "N/A")")
                Text("Playability: \(diag.primaryPlayabilityStatus ?? "N/A")")
                Text("URL: \(diag.resolvedUrl ?? "N/A")")
                    .lineLimit(4)
                if let avLog = avPlayerErrorLog {
                    Text("--- AVPlayer ---").foregroundColor(TLTheme.warning)
                    Text(avLog).foregroundColor(TLTheme.warning)
                }
                Text("--- Timeline ---")
                ForEach(diag.executionTimeline, id: \.self) { line in
                    Text(line)
                }
            }
            .font(.system(size: 18, design: .monospaced))
            .foregroundColor(TLTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(maxWidth: 1200, maxHeight: 520)
        .background(RoundedRectangle(cornerRadius: 16).fill(TLTheme.surface))
    }
    
    private func setupAndPlay() async {
        teardownPlayer()
        
        isLoadingStream = true
        isBuffering = true
        loadingStage = "Loading…"
        streamError = nil
        requiresSignIn = false
        avPlayerErrorLog = nil
        
        // Resolve stream first — sponsors load after playback starts.
        loadingStage = "Resolving streams…"
        let resolution = await TubeLiteGatewayClient.shared.resolvePlaybackItem(videoId: videoId)
        guard !Task.isCancelled else { return }
        self.diagnostics = resolution.diagnostics
        
        guard resolution.isPlayable else {
            self.isLoadingStream = false
            self.isBuffering = false
            self.streamError = resolution.error ?? "Unable to resolve playable stream"
            self.requiresSignIn = resolution.requiresAuth
            return
        }
        
        loadingStage = "Starting…"
        var item: AVPlayerItem?
        
        let codec = (resolution.selectedCodec ?? "").lowercased()
        let wantsComposition = codec != "avc1 hls"
            && codec.contains("av01")
            && resolution.selectedHeight >= 1440
            && resolution.compositionVideoURL != nil
            && resolution.compositionAudioURL != nil
        
        if wantsComposition,
           let videoURL = resolution.compositionVideoURL,
           let audioURL = resolution.compositionAudioURL {
            loadingStage = "Loading \(resolution.selectedHeight)p…"
            if let composed = await Self.makeCompositionPlayerItem(videoURL: videoURL, audioURL: audioURL) {
                guard !Task.isCancelled else { return }
                item = composed
                self.resourceLoader = nil
                if var d = self.diagnostics {
                    d.log("Playing via A/V composition @ \(resolution.selectedHeight)p")
                    self.diagnostics = d
                }
            } else if var d = self.diagnostics {
                d.log("Composition unavailable — falling back")
                self.diagnostics = d
            }
        }
        
        guard !Task.isCancelled else { return }
        
        if item == nil, let master = resolution.filteredHLSMaster {
            let loader = TubeLiteResourceLoader(masterPlaylist: master)
            self.resourceLoader = loader
            let asset = AVURLAsset(url: loader.masterURL)
            asset.resourceLoader.setDelegate(loader, queue: loader.queue)
            item = AVPlayerItem(asset: asset)
            if var d = self.diagnostics {
                d.log("Playing via filtered HLS (max \(resolution.selectedHeight)p)")
                self.diagnostics = d
            }
        }
        
        if item == nil, let progressive = resolution.progressiveURL {
            self.resourceLoader = nil
            item = AVPlayerItem(url: progressive)
            if var d = self.diagnostics {
                d.log("Playing via progressive MP4")
                self.diagnostics = d
            }
        }
        
        if item == nil,
           let videoURL = resolution.compositionVideoURL,
           let audioURL = resolution.compositionAudioURL {
            loadingStage = "Loading adaptive…"
            if let composed = await Self.makeCompositionPlayerItem(videoURL: videoURL, audioURL: audioURL) {
                guard !Task.isCancelled else { return }
                item = composed
                self.resourceLoader = nil
                if var d = self.diagnostics {
                    d.log("Playing via fallback A/V composition")
                    self.diagnostics = d
                }
            }
        }
        
        guard !Task.isCancelled else { return }
        
        guard let item else {
            self.isLoadingStream = false
            self.isBuffering = false
            self.streamError = resolution.error ?? "No playable stream for this video"
            self.requiresSignIn = resolution.requiresAuth
            return
        }
        
        Self.applyMaxQualityPreferences(to: item, targetHeight: resolution.selectedHeight)
        
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.actionAtItemEnd = .pause
        newPlayer.allowsExternalPlayback = true
        newPlayer.automaticallyWaitsToMinimizeStalling = true
        
        guard !Task.isCancelled else {
            newPlayer.pause()
            newPlayer.replaceCurrentItem(with: nil)
            return
        }
        
        self.player = newPlayer
        // Keep spinner up until we are actually playing.
        self.isLoadingStream = true
        self.isBuffering = true
        
        itemStatusObserver = item.observe(\.status, options: [.new, .initial]) { [weak newPlayer] observedItem, _ in
            Task { @MainActor in
                guard self.player === newPlayer else { return }
                switch observedItem.status {
                case .readyToPlay:
                    newPlayer?.play()
                case .failed:
                    self.capturePlayerFailure(from: observedItem)
                case .unknown:
                    break
                @unknown default:
                    break
                }
            }
        }
        
        timeControlObserver = newPlayer.observe(\.timeControlStatus, options: [.new, .initial]) { observedPlayer, _ in
            Task { @MainActor in
                guard self.player === observedPlayer else { return }
                switch observedPlayer.timeControlStatus {
                case .playing:
                    self.isLoadingStream = false
                    self.isBuffering = false
                case .waitingToPlayAtSpecifiedRate:
                    self.isBuffering = true
                case .paused:
                    // Initial attach is paused briefly before play() — keep spinner if still loading.
                    if !self.isLoadingStream {
                        self.isBuffering = false
                    }
                @unknown default:
                    break
                }
            }
        }
        
        errorLogObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemNewErrorLogEntry,
            object: item,
            queue: .main
        ) { _ in
            Task { @MainActor in
                guard self.player === newPlayer else { return }
                self.appendErrorLog(from: item)
            }
        }
        
        failedObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { notif in
            let err = notif.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            Task { @MainActor in
                guard self.player === newPlayer else { return }
                if let err {
                    self.avPlayerErrorLog = (self.avPlayerErrorLog.map { $0 + "\n" } ?? "") + err.localizedDescription
                }
                self.streamError = "Playback error"
                self.isLoadingStream = false
                self.isBuffering = false
                self.teardownPlayer()
            }
        }
        
        // Sponsors after playback path is live — don't block first frame.
        Task { @MainActor in
            let segments = await TubeLiteGatewayClient.shared.fetchSponsorSegments(videoId: videoId)
            guard !Task.isCancelled, self.player === newPlayer else { return }
            self.sponsorSegments = segments
            guard !segments.isEmpty else { return }
            if self.timeObserverToken == nil {
                let interval = CMTime(seconds: 0.5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
                self.timeObserverToken = newPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
                    guard self.player === newPlayer else { return }
                    let currentSec = CMTimeGetSeconds(time)
                    for segment in self.sponsorSegments {
                        if currentSec >= segment.start && currentSec < segment.end {
                            let targetTime = CMTime(seconds: segment.end + 0.1, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
                            newPlayer.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero)
                            Task { @MainActor in
                                guard self.player === newPlayer else { return }
                                self.showSponsorToast = true
                                try? await Task.sleep(nanoseconds: 2_500_000_000)
                                guard self.player === newPlayer else { return }
                                self.showSponsorToast = false
                            }
                            break
                        }
                    }
                }
            }
        }
    }
    
    private func capturePlayerFailure(from item: AVPlayerItem) {
        var parts: [String] = []
        if let err = item.error as NSError? {
            parts.append("\(err.domain) \(err.code): \(err.localizedDescription)")
            if let underlying = err.userInfo[NSUnderlyingErrorKey] as? NSError {
                parts.append("Underlying: \(underlying.domain) \(underlying.code): \(underlying.localizedDescription)")
            }
        }
        appendErrorLog(from: item)
        if let avLog = avPlayerErrorLog {
            parts.append(avLog)
        }
        let detailed = parts.joined(separator: "\n")
        print("[TubeLiteTV] AVPlayerItem failed:\n\(detailed)")
        avPlayerErrorLog = detailed
        // -12660 = HTTP 403 from CDN
        if detailed.contains("-12660") {
            streamError = "Stream forbidden (HTTP 403 / CoreMedia -12660). CDN rejected the media request."
        } else {
            streamError = "Playback Failed"
        }
        isLoadingStream = false
        isBuffering = false
        teardownPlayer()
    }
    
    private func appendErrorLog(from item: AVPlayerItem) {
        guard let errorLog = item.errorLog() else { return }
        var lines: [String] = avPlayerErrorLog.map { [$0] } ?? []
        for event in errorLog.events.suffix(8) {
            let line = "Code: \(event.errorStatusCode) (\(event.errorDomain)) | \(event.errorComment ?? "") | URI: \(event.uri ?? "")"
            if !lines.contains(line) {
                lines.append(line)
            }
        }
        avPlayerErrorLog = lines.joined(separator: "\n")
    }
    
    private func closePlayer() {
        teardownPlayer()
        onDismiss()
    }
    
    private func teardownPlayer() {
        if let token = timeObserverToken, let activePlayer = player {
            activePlayer.removeTimeObserver(token)
            timeObserverToken = nil
        }
        if let observer = failedObserver {
            NotificationCenter.default.removeObserver(observer)
            failedObserver = nil
        }
        if let observer = errorLogObserver {
            NotificationCenter.default.removeObserver(observer)
            errorLogObserver = nil
        }
        itemStatusObserver?.invalidate()
        itemStatusObserver = nil
        timeControlObserver?.invalidate()
        timeControlObserver = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        resourceLoader = nil
        isLoadingStream = false
        isBuffering = false
    }
    
    /// Push ABR toward the top available rung (1080 H.264 / up to 4K for AV1 composition).
    private static func applyMaxQualityPreferences(to item: AVPlayerItem, targetHeight: Int) {
        let height = max(targetHeight, 1080)
        let width = height >= 2160 ? 3840 : (height >= 1440 ? 2560 : 1920)
        item.preferredMaximumResolution = CGSize(width: width, height: height)
        // High peak bit rate = do not throttle below the top HLS rung.
        item.preferredPeakBitRate = height >= 2160 ? 35_000_000
            : (height >= 1440 ? 20_000_000 : 12_000_000)
        if #available(tvOS 15.0, *) {
            item.preferredPeakBitRateForExpensiveNetworks = item.preferredPeakBitRate
        }
    }
    
    /// Mux remote progressive video + audio into one AVPlayerItem (needed for AV1 4K).
    private static func makeCompositionPlayerItem(videoURL: URL, audioURL: URL) async -> AVPlayerItem? {
        do {
            let videoAsset = AVURLAsset(url: videoURL)
            let audioAsset = AVURLAsset(url: audioURL)
            
            async let vTracks = videoAsset.loadTracks(withMediaType: .video)
            async let aTracks = audioAsset.loadTracks(withMediaType: .audio)
            async let vDuration = videoAsset.load(.duration)
            async let aDuration = audioAsset.load(.duration)
            
            let videoTracks = try await vTracks
            let audioTracks = try await aTracks
            let videoDuration = try await vDuration
            let audioDuration = try await aDuration
            
            guard let videoTrack = videoTracks.first, let audioTrack = audioTracks.first else {
                return nil
            }
            
            let mix = AVMutableComposition()
            guard let compVideo = mix.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                  let compAudio = mix.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                return nil
            }
            
            let videoRange = CMTimeRange(start: .zero, duration: videoDuration)
            let audioRange = CMTimeRange(start: .zero, duration: audioDuration)
            try compVideo.insertTimeRange(videoRange, of: videoTrack, at: .zero)
            try compAudio.insertTimeRange(audioRange, of: audioTrack, at: .zero)
            
            return AVPlayerItem(asset: mix)
        } catch {
            print("[TubeLiteTV] Composition failed: \(error)")
            return nil
        }
    }
}
