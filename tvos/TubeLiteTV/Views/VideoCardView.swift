import SwiftUI

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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(TLTheme.spring, value: isFocused)
    }
    
    private var thumbContent: some View {
        ThumbnailFrame {
            ZStack(alignment: .bottomTrailing) {
                RemoteImage(url: video.thumbnailUrl, videoId: video.id)
                
                if !video.duration.isEmpty {
                    Text(video.duration)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.black.opacity(0.78))
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .padding(8)
                }
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
    
    private var metadata: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(video.title)
                .font(compact ? .caption2.weight(.semibold) : .caption.weight(.semibold))
                .foregroundColor(isFocused ? TLTheme.accent : TLTheme.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            
            if !video.channelTitle.isEmpty {
                Text(video.channelTitle)
                    .font(.caption2)
                    .foregroundColor(TLTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .allowsHitTesting(false)
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
            .frame(width: TLTheme.relatedCardWidth)
    }
}
