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
            .overlay {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            }
            .clipped()
    }
}

public enum ThumbnailURL {
    public static func candidates(primary: URL?, videoId: String?) -> [URL] {
        var list: [URL] = []
        if let n = normalize(primary) { list.append(n) }
        if let id = videoId, !id.isEmpty {
            // Prefer true 16:9 assets first; hqdefault/sddefault are 4:3 with bars.
            for file in ["maxresdefault.jpg", "hq720.jpg", "mqdefault.jpg", "hqdefault.jpg", "sddefault.jpg"] {
                if let u = URL(string: "https://i.ytimg.com/vi/\(id)/\(file)") {
                    list.append(u)
                }
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
}
