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
    
    @FocusState private var heroFocused: Bool
    
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
        [currentVideo.views, currentVideo.publishedAt]
            .filter { !$0.isEmpty }
            .joined(separator: "  ·  ")
    }
    
    public var body: some View {
        GeometryReader { geo in
            let layout = Self.heroLayout(in: geo.size)
            
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    heroButton(width: layout.width, height: layout.height)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                    
                    VStack(alignment: .leading, spacing: 6) {
                        Text(currentVideo.title)
                            .font(.callout.weight(.semibold))
                            .foregroundColor(TLTheme.textPrimary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                        
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
        .fullScreenCover(isPresented: $isPlaying, onDismiss: restoreFocus) {
            PlayerView(
                videoId: currentVideo.id,
                onOpenAccount: {
                    isPlaying = false
                    onOpenAccount()
                },
                onDismiss: { isPlaying = false }
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
        .onDisappear {
            // Nested cover can linger — force player closed when leaving watch.
            isPlaying = false
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
    
    /// Fit a true 16:9 hero so title/channel stay fully visible and related peeks below.
    private static func heroLayout(in size: CGSize) -> (width: CGFloat, height: CGFloat) {
        let maxWidth = max(320, size.width - TLTheme.pageInset * 2)
        // Reserve space: top pad + title/channel/meta + related peek.
        let reserved: CGFloat = 16 + 96 + 150
        let maxHeight = max(260, size.height - reserved)
        let heightFromWidth = maxWidth * 9 / 16
        if heightFromWidth <= maxHeight {
            return (maxWidth, heightFromWidth)
        }
        let width = maxHeight * 16 / 9
        return (width, maxHeight)
    }
    
    @ViewBuilder
    private var relatedSection: some View {
        if isLoadingRelated && relatedItems.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
        } else if !relatedItems.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: TLTheme.cardSpacing) {
                    ForEach(relatedItems) { item in
                        VideoCardView(video: item, compact: true) { selected in
                            currentVideo = selected
                            isPlaying = true
                        }
                        .frame(width: TLTheme.relatedCardWidth)
                    }
                }
                .padding(.horizontal, TLTheme.pageInset)
                .padding(.vertical, 8)
            }
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
