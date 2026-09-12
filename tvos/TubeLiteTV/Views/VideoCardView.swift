import SwiftUI
import UIKit

/// Video card: only the thumbnail is focusable (avoids the full-card white focus plate).
public struct VideoCardView: View {
    public let video: VideoItem
    public let compact: Bool
    public let onSelect: (VideoItem) -> Void
    
    @FocusState private var isFocused: Bool
    
    public init(video: VideoItem, compact: Bool = false, onSelect: @escaping (VideoItem) -> Void) {
        self.video = video
        self.compact = compact
        self.onSelect = onSelect
    }
    
    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                onSelect(video)
            } label: {
                thumbContent
            }
            .buttonStyle(TLBareButtonStyle())
            .focused($isFocused)
            .focusEffectDisabled(true)
            .hoverEffectDisabled(true)
            .accessibilityLabel(video.title)
            
            metadata
        }
        .frame(width: compact ? TLTheme.relatedCardWidth : nil, alignment: .topLeading)
        .frame(maxWidth: compact ? TLTheme.relatedCardWidth : .infinity, alignment: .topLeading)
        .fixedSize(horizontal: false, vertical: true)
        .animation(TLTheme.spring, value: isFocused)
        .task(id: isFocused) {
            guard isFocused else {
                // Focus left — cancel in-flight preload but keep any cached result.
                PlaybackPreloadCache.shared.cancelInflight(videoId: video.id)
                return
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            PlaybackPreloadCache.shared.preload(videoId: video.id)
        }
    }
    
    /// Locked 16:9 box — fixed px on tray cards, aspect-locked width on the home grid.
    private var thumbContent: some View {
        Group {
            if compact {
                thumbInner
                    .frame(width: TLTheme.relatedCardWidth, height: TLTheme.relatedThumbHeight)
                    .clipped()
            } else {
                ThumbnailFrame { thumbInner }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: TLTheme.radiusThumb, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TLTheme.radiusThumb, style: .continuous)
                .strokeBorder(isFocused ? Color.white : Color.clear, lineWidth: 3)
        )
        .scaleEffect(isFocused ? 1.04 : 1.0)
        .contentShape(RoundedRectangle(cornerRadius: TLTheme.radiusThumb, style: .continuous))
    }
    
    private var thumbInner: some View {
        ZStack(alignment: .bottomTrailing) {
            RemoteImage(url: video.thumbnailUrl, videoId: video.id)
            if !video.duration.isEmpty {
                durationBadge
            }
        }
    }
    
    private var durationBadge: some View {
        Text(video.duration)
            .font(.caption2.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.78))
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            .padding(8)
    }
    
    private var metadata: some View {
        HStack(alignment: .top, spacing: compact ? 10 : 12) {
            ChannelAvatar(
                url: video.channelThumbnailUrl,
                channelTitle: video.channelTitle,
                size: compact ? 36 : 44
            )
            
            VStack(alignment: .leading, spacing: 6) {
                // Natural flow: 1-line titles stay compact, 2-line expand, >2 truncated with "...".
                Text(video.title)
                    .font(compact ? .caption2.weight(.semibold) : .caption.weight(.semibold))
                    .foregroundColor(isFocused ? TLTheme.accent : TLTheme.textPrimary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                
                Text(video.channelTitle.isEmpty ? " " : video.channelTitle)
                    .font(.caption2)
                    .foregroundColor(TLTheme.textSecondary)
                    .lineLimit(1)
                    .opacity(video.channelTitle.isEmpty ? 0 : 1)
                
                Text(statsLine.isEmpty ? " " : statsLine)
                    .font(.caption2)
                    .foregroundColor(TLTheme.textTertiary)
                    .lineLimit(1)
                    .opacity(statsLine.isEmpty ? 0 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.horizontal, 6)
        .padding(.top, compact ? 24 : 18)
        .padding(.bottom, 4)
        // Ensure compact cards in the horizontal tray have uniform height
        // so the ScrollView doesn't clip 2-line titles.
        .frame(minHeight: compact ? TLTheme.relatedMetaHeight : nil, alignment: .topLeading)
        .allowsHitTesting(false)
    }
    
    private var statsLine: String {
        video.cardStatsLine
    }
}

/// Circular channel image — loads real yt3 avatars; letter only as last resort.
public struct ChannelAvatar: View {
    public let url: URL?
    public let channelTitle: String
    public let size: CGFloat
    
    @State private var image: UIImage? = nil
    @State private var loadFailed = false
    @State private var candidateIndex = 0
    
    public init(url: URL?, channelTitle: String, size: CGFloat = 44) {
        self.url = url
        self.channelTitle = channelTitle
        self.size = size
    }
    
    private var initial: String {
        let trimmed = channelTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }
    
    private var candidates: [URL] {
        ThumbnailURL.channelCandidates(primary: url, side: Int(size * 2))
    }
    
    public var body: some View {
        ZStack {
            Circle()
                .fill(TLTheme.surfaceElevated)
            
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if loadFailed || candidates.isEmpty {
                Text(initial)
                    .font(.system(size: size * 0.38, weight: .semibold))
                    .foregroundColor(TLTheme.textSecondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
        .task(id: url?.absoluteString) {
            image = nil
            loadFailed = false
            candidateIndex = 0
            await loadImage()
        }
    }
    
    private func loadImage() async {
        let urls = candidates
        guard !urls.isEmpty else {
            loadFailed = true
            return
        }
        for (idx, candidate) in urls.enumerated() {
            candidateIndex = idx
            var request = URLRequest(url: candidate)
            request.setValue(
                "Mozilla/5.0 (Apple TV; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
                forHTTPHeaderField: "User-Agent"
            )
            request.timeoutInterval = 12
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard status == 200 || status == 0,
                      let ui = UIImage(data: data),
                      ui.size.width > 1 else {
                    continue
                }
                await MainActor.run {
                    self.image = ui
                    self.loadFailed = false
                }
                return
            } catch {
                continue
            }
        }
        await MainActor.run { self.loadFailed = true }
    }
}

public struct RelatedVideoRow: View {
    public let video: VideoItem
    public let onSelect: (VideoItem) -> Void
    
    public init(video: VideoItem, onSelect: @escaping (VideoItem) -> Void) {
        self.video = video
        self.onSelect = onSelect
    }
    
    public var body: some View {
        VideoCardView(video: video, compact: true, onSelect: onSelect)
    }
}
