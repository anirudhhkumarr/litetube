import SwiftUI

/// Remote image that always fills its parent (crop, never stretch).
public struct RemoteImage: View {
    let url: URL?
    var videoId: String? = nil
    
    @State private var index = 0
    
    public init(url: URL?, videoId: String? = nil, contentMode: ContentMode = .fill) {
        self.url = url
        self.videoId = videoId
        // contentMode kept for call-site compatibility; always fill+crop.
        _ = contentMode
    }
    
    public var body: some View {
        let urls = ThumbnailURL.candidates(primary: url, videoId: videoId)
        let current = index < urls.count ? urls[index] : nil
        
        AsyncImage(url: current) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
                    .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                    .clipped()
            case .failure:
                Color.clear
                    .onAppear {
                        if index + 1 < urls.count { index += 1 }
                    }
                    .overlay { placeholder }
            case .empty:
                placeholder
            @unknown default:
                placeholder
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
        .clipped()
        .onChange(of: videoId) { _, _ in index = 0 }
        .onChange(of: url) { _, _ in index = 0 }
    }
    
    private var placeholder: some View {
        ZStack {
            TLTheme.surface
            Image(systemName: "play.rectangle.fill")
                .font(.system(size: 28, weight: .medium))
                .foregroundColor(TLTheme.textTertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Fixed 16:9 frame — image is cropped to fit, never stretched or letterboxed into a different ratio.
public struct ThumbnailFrame<Content: View>: View {
    @ViewBuilder var content: () -> Content
    
    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }
    
    public var body: some View {
        Color.clear
            .aspectRatio(16 / 9, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            }
            .clipped()
            // Prevent LazyVGrid row stretching from growing the thumb.
            .fixedSize(horizontal: false, vertical: true)
    }
}

public enum ThumbnailURL {
    public static func candidates(primary: URL?, videoId: String?) -> [URL] {
        var list: [URL] = []
        if let id = videoId, !id.isEmpty {
            // Best quality first — exists for most modern videos.
            if let u = URL(string: "https://i.ytimg.com/vi/\(id)/maxresdefault.jpg") {
                list.append(u)
            }
        }
        // API-provided URL as primary fallback (guaranteed to exist).
        if let n = normalize(primary) { list.append(n) }
        if let id = videoId, !id.isEmpty {
            // Last resort — always exists, true 4:3 but usable.
            if let u = URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg") {
                list.append(u)
            }
        }
        var seen = Set<String>()
        return list.filter { seen.insert($0.absoluteString).inserted }
    }
    
    public static func normalize(_ url: URL?) -> URL? {
        guard let url else { return nil }
        var s = url.absoluteString
        if s.hasPrefix("//") { s = "https:" + s }
        if s.hasPrefix("http://") { s = "https://" + String(s.dropFirst(7)) }
        return URL(string: s)
    }
    
    /// yt3 avatar URLs often need an explicit size suffix; try a few reliable sizes.
    public static func channelCandidates(primary: URL?, side: Int) -> [URL] {
        guard let s = normalize(primary)?.absoluteString else { return [] }
        let px = max(side, 88)
        var list: [URL] = []
        
        // Try requested size, then common reliable sizes
        let sizes = Array(Set([px, 176, 240])).sorted()
        
        if let range = s.range(of: #"=s\d+"#, options: .regularExpression) {
            for sz in sizes {
                let sized = s.replacingCharacters(in: range, with: "=s\(sz)")
                if let u = URL(string: sized) { list.append(u) }
            }
            // Bare URL without size param as last resort
            let bare = s[s.startIndex..<range.lowerBound]
            if let u = URL(string: String(bare)) { list.append(u) }
        } else if !s.contains("=s") {
            // Original URL as-is first
            if let u = URL(string: s) { list.append(u) }
            for sz in sizes {
                if let u = URL(string: s + "=s\(sz)-c-k-c0x00ffffff-no-rj") { list.append(u) }
            }
        } else {
            if let u = URL(string: s) { list.append(u) }
        }
        
        var seen = Set<String>()
        return list.filter { seen.insert($0.absoluteString).inserted }
    }
}
