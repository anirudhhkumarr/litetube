import SwiftUI

/// Watch page after leaving the player: sized hero + metadata + related peek on one screen.
/// Select the hero thumbnail to play again. Menu/back dismisses to the feed.
public struct WatchView: View {
    public let initialVideo: VideoItem
    public let onOpenAccount: () -> Void
    public let onDismiss: () -> Void
    
    @State private var currentVideo: VideoItem
    @State private var related: [VideoItem] = []
    @State private var isLoadingRelated = true
    @State private var isPlaying = true
    
    @State private var lastDiagnostics: TubeLiteGatewayClient.PlaybackDiagnostics? = nil
    @State private var lastAVPlayerLog: String? = nil
    @State private var showLogs = false
    
    @FocusState private var heroFocused: Bool
    @FocusState private var logsButtonFocused: Bool
    @FocusState private var logsCloseFocused: Bool
    
    public init(
        video: VideoItem,
        onOpenAccount: @escaping () -> Void = {},
        onDismiss: @escaping () -> Void
    ) {
        self.initialVideo = video
        self.onOpenAccount = onOpenAccount
        self.onDismiss = onDismiss
        self._currentVideo = State(initialValue: video)
    }
    
    private var relatedItems: [VideoItem] {
        related.filter { !$0.isShort && $0.id != currentVideo.id }
    }
    
    private var metaLine: String {
        currentVideo.cardStatsLine
    }
    
    private var hasLogs: Bool {
        lastDiagnostics != nil || !(lastAVPlayerLog ?? "").isEmpty
    }
    
    public var body: some View {
        GeometryReader { geo in
            let layout = Self.heroLayout(in: geo.size)
            
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    heroButton(width: layout.width, height: layout.height)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                        .padding(.horizontal, TLTheme.pageInset)
                    
                    HStack(alignment: .top, spacing: 14) {
                        ChannelAvatar(
                            url: currentVideo.channelThumbnailUrl,
                            channelTitle: currentVideo.channelTitle,
                            size: 48
                        )
                        
                        VStack(alignment: .leading, spacing: 6) {
                            Text(currentVideo.title)
                                .font(.callout.weight(.semibold))
                                .foregroundColor(TLTheme.textPrimary)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            
                            HStack(alignment: .center, spacing: 16) {
                                VStack(alignment: .leading, spacing: 4) {
                                    if !currentVideo.channelTitle.isEmpty {
                                        Text(currentVideo.channelTitle)
                                            .font(.caption)
                                            .foregroundColor(TLTheme.textSecondary)
                                            .lineLimit(1)
                                    }
                                    
                                    if !metaLine.isEmpty {
                                        Text(metaLine)
                                            .font(.caption2)
                                            .foregroundColor(TLTheme.textTertiary)
                                            .lineLimit(1)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                
                                if hasLogs {
                                    logsButton
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, TLTheme.pageInset)
                    
                    relatedSection
                        .padding(.top, 4)
                        .padding(.bottom, 48)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TLTheme.canvas.ignoresSafeArea())
        .defaultFocus($heroFocused, true)
        .fullScreenCover(isPresented: $showLogs) {
            logsSheet
        }
        .fullScreenCover(isPresented: $isPlaying, onDismiss: restoreFocus) {
            PlayerView(
                videoId: currentVideo.id,
                onOpenAccount: {
                    isPlaying = false
                    onOpenAccount()
                },
                onDismiss: { isPlaying = false },
                onDiagnostics: { diag, avLog in
                    lastDiagnostics = diag
                    lastAVPlayerLog = avLog
                }
            )
            .id(currentVideo.id)
        }
        .onExitCommand {
            if isPlaying {
                isPlaying = false
            } else {
                onDismiss()
            }
        }
        .onChange(of: isPlaying) { _, playing in
            if !playing { restoreFocus() }
        }
        .onChange(of: currentVideo.id) { _, _ in
            lastDiagnostics = nil
            lastAVPlayerLog = nil
            showLogs = false
        }
        .onDisappear {
            // Nested cover can linger — force player closed when leaving watch.
            isPlaying = false
            // Cancel any in-flight preloads so they don't stall the home feed.
            PlaybackPreloadCache.shared.cancelAll()
        }
        .task(id: currentVideo.id) {
            // Playback first: defer related so stream resolve gets the network.
            isLoadingRelated = related.isEmpty
            if isPlaying {
                try? await Task.sleep(nanoseconds: 3_500_000_000)
            }
            guard !Task.isCancelled else { return }
            let (_, r) = await TubeLiteGatewayClient.shared.fetchWatchNext(videoId: currentVideo.id)
            guard !Task.isCancelled else { return }
            related = r
            isLoadingRelated = false
        }
    }
    
    /// Fit a true 16:9 hero so title/channel stay visible and related thumbs only half-peek.
    private static func heroLayout(in size: CGSize) -> (width: CGFloat, height: CGFloat) {
        let maxWidth = max(320, size.width - TLTheme.pageInset * 2)
        // Top pad + title/channel/meta + ~half a related thumbnail (not a full card).
        let relatedPeek = TLTheme.trayThumbHeight * 0.5
        let reserved: CGFloat = 16 + 88 + relatedPeek
        let maxHeight = max(280, size.height - reserved)
        let heightFromWidth = maxWidth * 9 / 16
        if heightFromWidth <= maxHeight {
            return (maxWidth, heightFromWidth)
        }
        let width = maxHeight * 16 / 9
        return (width, maxHeight)
    }
    
    private var logsButton: some View {
        Button {
            showLogs = true
        } label: {
            Text("Logs")
                .font(.caption.weight(.semibold))
                .foregroundColor(logsButtonFocused ? TLTheme.canvas : TLTheme.accent)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule(style: .continuous)
                        .fill(logsButtonFocused ? Color.white : TLTheme.surfaceElevated)
                )
        }
        .buttonStyle(TLBareButtonStyle())
        .focused($logsButtonFocused)
        .focusEffectDisabled(true)
        .accessibilityLabel("Video playback logs")
    }
    
    private var logLines: [String] {
        var lines: [String] = []
        if let diag = lastDiagnostics {
            lines.append(contentsOf: diag.executionTimeline.reversed())
            if let avLog = lastAVPlayerLog, !avLog.isEmpty {
                lines.append(contentsOf: avLog.components(separatedBy: "\n").filter { !$0.isEmpty }.reversed())
            }
            lines.append("Video: \(diag.videoId)")
            lines.append("Stage: \(diag.failureStage ?? "None")")
            lines.append("HTTP: \(diag.primaryHttpStatus.map(String.init) ?? "N/A")")
            lines.append("Playability: \(diag.primaryPlayabilityStatus ?? "N/A")")
            if let reason = diag.primaryPlayabilityReason, !reason.isEmpty {
                lines.append("Reason: \(reason)")
            }
            if let url = diag.resolvedUrl, !url.isEmpty {
                lines.append("URL: \(url)")
            }
        } else if let avLog = lastAVPlayerLog, !avLog.isEmpty {
            lines.append(contentsOf: avLog.components(separatedBy: "\n").filter { !$0.isEmpty }.reversed())
        } else {
            lines.append("No stream diagnostics captured yet.")
        }
        return lines
    }
    
    private var logsSheet: some View {
        ZStack {
            TLTheme.canvas.ignoresSafeArea()
            
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Playback Logs")
                        .font(.title3.weight(.semibold))
                        .foregroundColor(TLTheme.textPrimary)
                    Spacer()
                    Button("Close") {
                        showLogs = false
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(logsCloseFocused ? .white : TLTheme.surfaceElevated)
                    .focused($logsCloseFocused)
                }
                .padding(.horizontal, TLTheme.pageInset)
                .padding(.top, 36)
                .padding(.bottom, 20)
                
                // List is focusable on tvOS so the Siri Remote can scroll.
                List {
                    ForEach(Array(logLines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 17, design: .monospaced))
                            .foregroundColor(
                                line.contains("-12660") || line.lowercased().contains("error")
                                ? TLTheme.warning
                                : TLTheme.textSecondary
                            )
                            .listRowBackground(TLTheme.surface)
                            .listRowInsets(EdgeInsets(top: 6, leading: 24, bottom: 6, trailing: 24))
                    }
                }
                .listStyle(.plain)
            }
        }
        .defaultFocus($logsCloseFocused, true)
        .onExitCommand { showLogs = false }
    }
    
    @ViewBuilder
    private var relatedSection: some View {
        if isLoadingRelated && relatedItems.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
        } else if !relatedItems.isEmpty {
            // Same card chrome as Home, but a single horizontal tray.
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: TLTheme.gridGap) {
                    ForEach(relatedItems) { item in
                        VideoCardView(video: item, compact: true) { selected in
                            currentVideo = selected
                            isPlaying = true
                        }
                    }
                }
                .padding(.horizontal, TLTheme.pageInset)
                .padding(.vertical, 8)
            }
            .focusSection()
        }
    }
    
    private func heroButton(width: CGFloat, height: CGFloat) -> some View {
        Button {
            isPlaying = true
        } label: {
            ZStack {
                RemoteImage(url: currentVideo.thumbnailUrl, videoId: currentVideo.id)
                Color.black.opacity(heroFocused ? 0.22 : 0.08)
            }
            .frame(width: width, height: height)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: TLTheme.radiusThumb, style: .continuous))
        }
        .buttonStyle(TLBareButtonStyle())
        .focused($heroFocused)
        .focusEffectDisabled(true)
        .frame(width: width, height: height)
        .overlay(
            RoundedRectangle(cornerRadius: TLTheme.radiusThumb, style: .continuous)
                .strokeBorder(heroFocused ? Color.white.opacity(0.95) : Color.clear, lineWidth: 3)
        )
        .animation(TLTheme.spring, value: heroFocused)
        .accessibilityLabel("Play \(currentVideo.title)")
        .task(id: heroFocused) {
            guard heroFocused else { return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            PlaybackPreloadCache.shared.preload(videoId: currentVideo.id)
        }
    }
    
    private func restoreFocus() {
        DispatchQueue.main.async {
            heroFocused = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if !heroFocused {
                heroFocused = true
            }
        }
    }
}
