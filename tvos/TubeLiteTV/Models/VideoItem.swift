import Foundation

/// Represents a video item displayed in the Apple TV TubeLite interface.
public struct VideoItem: Identifiable, Hashable, Codable {
    public let id: String
    public let title: String
    public let channelTitle: String
    public let channelId: String?
    public let duration: String
    public let views: String
    public let publishedAt: String
    public let thumbnailUrl: URL?
    public let channelThumbnailUrl: URL?
    public let isShort: Bool
    public let videoDescription: String
    public let subscriberCount: String
    
    public init(
        id: String,
        title: String,
        channelTitle: String,
        channelId: String? = nil,
        duration: String = "",
        views: String = "",
        publishedAt: String = "",
        thumbnailUrl: URL? = nil,
        channelThumbnailUrl: URL? = nil,
        isShort: Bool = false,
        videoDescription: String = "",
        subscriberCount: String = ""
    ) {
        self.id = id
        self.title = title
        self.channelTitle = channelTitle
        self.channelId = channelId
        self.duration = duration
        self.views = views
        self.publishedAt = publishedAt
        self.thumbnailUrl = thumbnailUrl
        self.channelThumbnailUrl = channelThumbnailUrl
        self.isShort = isShort
        self.videoDescription = videoDescription
        self.subscriberCount = subscriberCount
    }
}

/// Robust JSON parser for YouTube InnerTube browse, search, and watch next payloads
public enum InnerTubeParser {
    
    /// Parses InnerTube response dictionary into a list of VideoItem models
    public static func parse(json: [String: Any]) -> [VideoItem] {
        return parseWithContinuation(json: json).videos
    }
    
    /// Parses InnerTube response dictionary into videos and continuation token
    public static func parseWithContinuation(json: [String: Any]) -> (videos: [VideoItem], continuationToken: String?) {
        var results: [VideoItem] = []
        var visitedIds = Set<String>()
        var foundContinuationToken: String? = nil
        
        // Traverse dictionary recursively to extract all videoRenderer, lockupViewModel, and continuation items
        func traverse(_ node: Any) {
            if let dict = node as? [String: Any] {
                // Continuation Token Extraction
                if foundContinuationToken == nil {
                    if let contItem = dict["continuationItemRenderer"] as? [String: Any],
                       let endpoint = contItem["continuationEndpoint"] as? [String: Any],
                       let command = endpoint["continuationCommand"] as? [String: Any],
                       let token = command["token"] as? String {
                        foundContinuationToken = token
                    } else if let nextCont = dict["nextContinuationData"] as? [String: Any],
                              let token = nextCont["continuation"] as? String {
                        foundContinuationToken = token
                    }
                }
                
                // Case 1: Standard YouTube videoRenderer
                if let vr = dict["videoRenderer"] as? [String: Any] {
                    if let item = parseVideoRenderer(vr), !visitedIds.contains(item.id) {
                        visitedIds.insert(item.id)
                        results.append(item)
                    }
                    return
                }
                
                // Case 2: Modern lockupViewModel (YouTube TV & Web 2024+)
                if let lockup = dict["lockupViewModel"] as? [String: Any] {
                    if let item = parseLockupViewModel(lockup), !visitedIds.contains(item.id) {
                        visitedIds.insert(item.id)
                        results.append(item)
                    }
                    return
                }
                
                // Case 3: Compact video renderer (Watch page recommendations)
                if let cvr = dict["compactVideoRenderer"] as? [String: Any] {
                    if let item = parseVideoRenderer(cvr), !visitedIds.contains(item.id) {
                        visitedIds.insert(item.id)
                        results.append(item)
                    }
                    return
                }
                
                // Case 4: Grid video renderer
                if let gvr = dict["gridVideoRenderer"] as? [String: Any] {
                    if let item = parseVideoRenderer(gvr), !visitedIds.contains(item.id) {
                        visitedIds.insert(item.id)
                        results.append(item)
                    }
                    return
                }
                
                // Case 5: Tile renderer (YouTube TV)
                if let tr = dict["tileRenderer"] as? [String: Any] {
                    if let item = parseTileRenderer(tr), !visitedIds.contains(item.id) {
                        visitedIds.insert(item.id)
                        results.append(item)
                    }
                    return
                }
                
                // Recurse child nodes
                for (_, value) in dict {
                    traverse(value)
                }
            } else if let array = node as? [Any] {
                for item in array {
                    traverse(item)
                }
            }
        }
        
        traverse(json)
        return (results, foundContinuationToken)
    }
    
    /// Parses watch next endpoint response to extract video details and related recommendations
    public static func parseWatchNext(json: [String: Any]) -> (details: VideoItem?, related: [VideoItem]) {
        var videoDetails: VideoItem? = nil
        
        // 1. Extract Video Details from videoPrimaryInfoRenderer and videoSecondaryInfoRenderer
        var primaryInfo: [String: Any]? = nil
        var secondaryInfo: [String: Any]? = nil
        
        if let contents = json["contents"] as? [String: Any] {
            let list: [[String: Any]] = {
                if let twoCol = contents["twoColumnWatchNextResults"] as? [String: Any],
                   let results = twoCol["results"] as? [String: Any],
                   let innerResults = results["results"] as? [String: Any],
                   let items = innerResults["contents"] as? [[String: Any]] {
                    return items
                }
                if let singleCol = contents["singleColumnWatchNextResults"] as? [String: Any],
                   let results = singleCol["results"] as? [String: Any],
                   let innerResults = results["results"] as? [String: Any],
                   let items = innerResults["contents"] as? [[String: Any]] {
                    return items
                }
                return []
            }()
            
            for item in list {
                if let p = item["videoPrimaryInfoRenderer"] as? [String: Any] ?? item["videoMetadataRenderer"] as? [String: Any] {
                    primaryInfo = p
                }
                if let s = item["videoSecondaryInfoRenderer"] as? [String: Any] {
                    secondaryInfo = s
                }
            }
        }
        
        if let primary = primaryInfo {
            let title = extractRunsText(primary["title"]) ?? extractSimpleText(primary["title"]) ?? ""
            
            var channelTitle = ""
            var channelThumbUrl: URL? = nil
            var channelId: String? = nil
            var desc = ""
            
            let ownerRenderer = (secondaryInfo?["owner"] as? [String: Any])?["videoOwnerRenderer"] as? [String: Any]
                ?? (primary["owner"] as? [String: Any])?["videoOwnerRenderer"] as? [String: Any]
            
            if let owner = ownerRenderer {
                channelTitle = extractRunsText(owner["title"]) ?? extractSimpleText(owner["title"]) ?? ""
                if let nav = owner["navigationEndpoint"] as? [String: Any],
                   let browse = nav["browseEndpoint"] as? [String: Any] {
                    channelId = browse["browseId"] as? String
                }
                if let thumb = owner["thumbnail"] as? [String: Any],
                   let thumbs = thumb["thumbnails"] as? [[String: Any]],
                   let first = thumbs.first?["url"] as? String {
                    channelThumbUrl = URL(string: first)
                }
            }
            
            if let descObj = secondaryInfo?["description"] as? [String: Any] ?? primary["description"] as? [String: Any] {
                desc = extractRunsText(descObj) ?? ""
            }
            
            let viewsText = extractRunsText(primary["viewCount"]) ?? extractSimpleText(primary["viewCount"]) ?? ""
            
            var videoId = ""
            if let endpoint = json["currentVideoEndpoint"] as? [String: Any],
               let watch = endpoint["watchEndpoint"] as? [String: Any],
               let vid = watch["videoId"] as? String {
                videoId = vid
            }
            
            videoDetails = VideoItem(
                id: videoId,
                title: title,
                channelTitle: channelTitle,
                channelId: channelId,
                views: viewsText,
                thumbnailUrl: nil,
                channelThumbnailUrl: channelThumbUrl,
                videoDescription: desc
            )
        } else if let currentDetails = json["videoDetails"] as? [String: Any] {
            let videoId = currentDetails["videoId"] as? String ?? ""
            let title = currentDetails["title"] as? String ?? ""
            let channel = currentDetails["author"] as? String ?? ""
            let desc = currentDetails["shortDescription"] as? String ?? ""
            let views = currentDetails["viewCount"] as? String ?? ""
            
            videoDetails = VideoItem(
                id: videoId,
                title: title,
                channelTitle: channel,
                views: "\(views) views",
                channelThumbnailUrl: nil,
                videoDescription: desc
            )
        }
        
        // Extract Related Recommendations
        let (related, _) = parseWithContinuation(json: json)
        return (videoDetails, related)
    }
    
    private static func parseVideoRenderer(_ dict: [String: Any]) -> VideoItem? {
        guard let videoId = dict["videoId"] as? String, !videoId.isEmpty else {
            return nil
        }
        
        // Extract Title
        let title = extractRunsText(dict["title"]) ?? ""
        
        // Extract Channel Title
        let channelTitle = extractRunsText(dict["ownerText"])
            ?? extractRunsText(dict["longBylineText"])
            ?? extractRunsText(dict["shortBylineText"])
            ?? ""
        
        // Extract Channel ID
        var channelId: String? = nil
        if let runs = (dict["ownerText"] as? [String: Any])?["runs"] as? [[String: Any]],
           let nav = runs.first?["navigationEndpoint"] as? [String: Any],
           let browseEndpoint = nav["browseEndpoint"] as? [String: Any] {
            channelId = browseEndpoint["browseId"] as? String
        }
        
        // Extract Duration
        let duration = extractSimpleText(dict["lengthText"])
            ?? extractRunsText(dict["lengthText"])
            ?? ""
        
        // Extract Views
        let views = extractSimpleText(dict["viewCountText"])
            ?? extractRunsText(dict["viewCountText"])
            ?? extractSimpleText(dict["shortViewCountText"])
            ?? ""
        
        // Extract Published Time
        let publishedAt = extractSimpleText(dict["publishedTimeText"]) ?? ""
        
        // Extract Description Snippet
        let desc = extractRunsText(dict["descriptionSnippet"]) ?? ""
        
        // Extract Thumbnail URL
        var thumbUrl: URL? = nil
        if let thumbnails = (dict["thumbnail"] as? [String: Any])?["thumbnails"] as? [[String: Any]],
           let best = thumbnails.last?["url"] as? String {
            thumbUrl = ThumbnailURL.normalize(URL(string: best))
        }
        if thumbUrl == nil {
            thumbUrl = URL(string: "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg")
        }
        
        // Extract Channel Thumbnail URL
        var channelThumbUrl: URL? = nil
        if let renderers = dict["channelThumbnailSupportedRenderers"] as? [String: Any],
           let linkRenderer = renderers["channelThumbnailWithLinkRenderer"] as? [String: Any],
           let thumb = linkRenderer["thumbnail"] as? [String: Any],
           let thumbs = thumb["thumbnails"] as? [[String: Any]],
           let first = thumbs.first?["url"] as? String {
            channelThumbUrl = URL(string: first)
        } else if let channelThumb = dict["channelThumbnail"] as? [String: Any],
                  let thumbs = channelThumb["thumbnails"] as? [[String: Any]],
                  let first = thumbs.first?["url"] as? String {
            channelThumbUrl = URL(string: first)
        }
        
        // Filter out shorts
        let isShort = duration.contains("0:") && (Int(duration.replacingOccurrences(of: "0:", with: "")) ?? 99) < 60
        
        return VideoItem(
            id: videoId,
            title: title,
            channelTitle: channelTitle,
            channelId: channelId,
            duration: duration,
            views: views,
            publishedAt: publishedAt,
            thumbnailUrl: thumbUrl,
            channelThumbnailUrl: channelThumbUrl,
            isShort: isShort,
            videoDescription: desc
        )
    }
    
    private static func parseLockupViewModel(_ dict: [String: Any]) -> VideoItem? {
        // Reject non-video lockup content types immediately (channels, playlists, radios, etc.)
        if let contentType = dict["contentType"] as? String {
            if contentType == "LOCKUP_CONTENT_TYPE_CHANNEL" ||
               contentType == "LOCKUP_CONTENT_TYPE_PLAYLIST" ||
               contentType == "LOCKUP_CONTENT_TYPE_RADIO" ||
               contentType == "LOCKUP_CONTENT_TYPE_MIX" ||
               contentType == "LOCKUP_CONTENT_TYPE_POST" ||
               contentType == "LOCKUP_CONTENT_TYPE_GAME" {
                return nil
            }
        }
        
        // Extract video ID (from onTap command or contentId)
        var videoId = dict["contentId"] as? String ?? ""
        if let rendererContext = dict["rendererContext"] as? [String: Any],
           let commandContext = rendererContext["commandContext"] as? [String: Any],
           let onTap = commandContext["onTap"] as? [String: Any],
           let innertubeCommand = onTap["innertubeCommand"] as? [String: Any] {
            if let watchEndpoint = innertubeCommand["watchEndpoint"] as? [String: Any],
               let vid = watchEndpoint["videoId"] as? String {
                videoId = vid
            } else if let reelWatchEndpoint = innertubeCommand["reelWatchEndpoint"] as? [String: Any],
                      let vid = reelWatchEndpoint["videoId"] as? String {
                videoId = vid
            }
        }
        if videoId.isEmpty,
           let onTap = dict["onTap"] as? [String: Any],
           let innertubeCommand = onTap["innertubeCommand"] as? [String: Any] {
            if let watchEndpoint = innertubeCommand["watchEndpoint"] as? [String: Any],
               let vid = watchEndpoint["videoId"] as? String {
                videoId = vid
            } else if let reelWatchEndpoint = innertubeCommand["reelWatchEndpoint"] as? [String: Any],
                      let vid = reelWatchEndpoint["videoId"] as? String {
                videoId = vid
            }
        }
        
        guard !videoId.isEmpty, !videoId.hasPrefix("UC"), !videoId.hasPrefix("PL"), !videoId.hasPrefix("@") else {
            return nil
        }
        
        // Metadata View Model
        let metadata = dict["metadata"] as? [String: Any]
        let lockupMetadata = metadata?["lockupMetadataViewModel"] as? [String: Any]
        
        // Title
        var title = ""
        if let titleObj = lockupMetadata?["title"] {
            title = extractRunsText(titleObj) ?? ""
        }
        if title.isEmpty, let overlayMeta = dict["overlayMetadata"] as? [String: Any] {
            title = extractRunsText(overlayMeta["primaryText"]) ?? ""
        }
        
        // Content Metadata Rows (Channel, Views, Published Time)
        var channelTitle = ""
        var channelId: String? = nil
        var views = ""
        var publishedAt = ""
        
        if let meta = lockupMetadata?["metadata"] as? [String: Any],
           let contentMeta = meta["contentMetadataViewModel"] as? [String: Any],
           let metadataRows = contentMeta["metadataRows"] as? [[String: Any]] {
            
            for row in metadataRows {
                guard let parts = row["metadataParts"] as? [[String: Any]] else { continue }
                for p in parts {
                    let text: String
                    if let textObj = p["text"] {
                        text = extractRunsText(textObj) ?? ""
                    } else if let t = p["text"] as? String {
                        text = t
                    } else {
                        text = p["accessibilityLabel"] as? String ?? ""
                    }
                    if text.isEmpty { continue }
                    
                    // 1. Channel identification via browseEndpoint (UC... or @handle or /@ or /channel/)
                    var isChannelEndpoint = false
                    var endpointBrowseId: String? = nil
                    if let cmd = p["commandContext"] as? [String: Any],
                       let onTap = cmd["onTap"] as? [String: Any],
                       let innertubeCommand = onTap["innertubeCommand"] as? [String: Any] {
                        if let browseEndpoint = innertubeCommand["browseEndpoint"] as? [String: Any],
                           let bId = browseEndpoint["browseId"] as? String {
                            endpointBrowseId = bId
                            if bId.hasPrefix("UC") || bId.hasPrefix("@") {
                                isChannelEndpoint = true
                            }
                        }
                        if let webCmd = (innertubeCommand["commandMetadata"] as? [String: Any])?["webCommandMetadata"] as? [String: Any],
                           let url = webCmd["url"] as? String {
                            if url.contains("/@") || url.contains("/channel/") {
                                isChannelEndpoint = true
                            }
                        }
                    }
                    
                    if isChannelEndpoint {
                        if channelTitle.isEmpty { channelTitle = text }
                        if channelId == nil { channelId = endpointBrowseId }
                        continue
                    }
                    
                    // 2. Metrics / Views identification
                    let lower = text.lowercased()
                    let accLower = (p["accessibilityLabel"] as? String ?? "").lowercased()
                    let isViews = lower.contains("view") || lower.contains("watching") || accLower.contains("view") || accLower.contains("watching")
                    if isViews && views.isEmpty {
                        if let acc = p["accessibilityLabel"] as? String, !acc.isEmpty {
                            views = acc
                        } else {
                            views = lower.contains("view") ? text : "\(text) views"
                        }
                        continue
                    }
                    
                    // 3. Published time / Relative date identification
                    let isTimestamp = lower.contains("ago") || lower.contains("streamed") || lower.contains("premiered") || lower.contains("yesterday") || lower.contains("today") || accLower.contains("ago")
                    if isTimestamp && publishedAt.isEmpty {
                        publishedAt = text
                        continue
                    }
                    
                    // 4. Non-metric text fallback for channel title
                    let trimmed = lower.trimmingCharacters(in: .whitespacesAndNewlines)
                    let skipKeywords = ["new", "cc", "4k", "hd", "subtitles", "shorts"]
                    if channelTitle.isEmpty && !isViews && !isTimestamp && !skipKeywords.contains(trimmed) {
                        channelTitle = text
                    }
                }
            }
        }
        
        // Shorts lockup fallback (shortsLockupViewModel has overlayMetadata)
        if views.isEmpty, let overlayMeta = dict["overlayMetadata"] as? [String: Any] {
            if let sec = extractRunsText(overlayMeta["secondaryText"]) {
                views = sec
            }
        }
        
        // Duration & Overlays
        var duration = ""
        var isShort = false
        if let contentImage = dict["contentImage"] as? [String: Any],
           let thumbVM = contentImage["thumbnailViewModel"] as? [String: Any],
           let overlays = thumbVM["overlays"] as? [[String: Any]] {
            for ov in overlays {
                if let bottomOv = ov["thumbnailBottomOverlayViewModel"] as? [String: Any],
                   let badges = bottomOv["badges"] as? [[String: Any]] {
                    for b in badges {
                        if let badgeVM = b["thumbnailBadgeViewModel"] as? [String: Any],
                           let text = badgeVM["text"] as? String {
                            if text.uppercased() == "SHORTS" {
                                isShort = true
                            } else if duration.isEmpty {
                                duration = text
                            }
                        }
                    }
                }
            }
        }
        
        // Thumbnail URL with high-res fallback
        var thumbUrl: URL? = nil
        if let contentImage = dict["contentImage"] as? [String: Any] {
            // Check direct thumbnailViewModel
            if let thumbVM = contentImage["thumbnailViewModel"] as? [String: Any],
               let image = thumbVM["image"] as? [String: Any],
               let sources = image["sources"] as? [[String: Any]],
               let lastUrl = sources.last?["url"] as? String {
                thumbUrl = URL(string: lastUrl)
            }
            // Check collectionThumbnailViewModel
            else if let collection = contentImage["collectionThumbnailViewModel"] as? [String: Any],
                    let primaryThumb = collection["primaryThumbnail"] as? [String: Any],
                    let thumbVM = primaryThumb["thumbnailViewModel"] as? [String: Any],
                    let image = thumbVM["image"] as? [String: Any],
                    let sources = image["sources"] as? [[String: Any]],
                    let lastUrl = sources.last?["url"] as? String {
                thumbUrl = URL(string: lastUrl)
            }
        }
        
        // Fallback to official YouTube high-quality thumbnail if none found
        if thumbUrl == nil {
            thumbUrl = URL(string: "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg")
        } else {
            thumbUrl = ThumbnailURL.normalize(thumbUrl)
        }
        
        // Channel Thumbnail from lockupMetadata
        var channelThumbUrl: URL? = nil
        if let avatar = lockupMetadata?["avatar"] as? [String: Any] {
            if let decorated = avatar["decoratedAvatarViewModel"] as? [String: Any],
               let avm = (decorated["avatar"] as? [String: Any])?["avatarViewModel"] as? [String: Any],
               let image = avm["image"] as? [String: Any],
               let sources = image["sources"] as? [[String: Any]],
               let first = sources.first?["url"] as? String {
                channelThumbUrl = URL(string: first)
            } else if let avm = avatar["avatarViewModel"] as? [String: Any],
                      let image = avm["image"] as? [String: Any],
                      let sources = image["sources"] as? [[String: Any]],
                      let first = sources.first?["url"] as? String {
                channelThumbUrl = URL(string: first)
            }
        }
        
        return VideoItem(
            id: videoId,
            title: title,
            channelTitle: channelTitle,
            channelId: channelId,
            duration: duration,
            views: views,
            publishedAt: publishedAt,
            thumbnailUrl: thumbUrl,
            channelThumbnailUrl: channelThumbUrl,
            isShort: isShort
        )
    }
    
    private static func parseTileRenderer(_ dict: [String: Any]) -> VideoItem? {
        if let contentType = dict["contentType"] as? String {
            if contentType == "TILE_CONTENT_TYPE_CHANNEL" ||
               contentType == "TILE_CONTENT_TYPE_PLAYLIST" ||
               contentType == "TILE_CONTENT_TYPE_RADIO" ||
               contentType == "TILE_CONTENT_TYPE_MIX" ||
               contentType == "TILE_CONTENT_TYPE_POST" ||
               contentType == "TILE_CONTENT_TYPE_GAME" {
                return nil
            }
        }

        // Check onSelectCommand / navigationEndpoint: collection browse pages are not standalone videos
        let onSelect = (dict["onSelectCommand"] as? [String: Any]) ?? (dict["navigationEndpoint"] as? [String: Any])
        if let browseEndpoint = onSelect?["browseEndpoint"] as? [String: Any] {
            let browseId = browseEndpoint["browseId"] as? String ?? ""
            if browseId.hasPrefix("VL") ||
               browseId.hasPrefix("PL") ||
               browseId.hasPrefix("RD") ||
               browseId.hasPrefix("UU") ||
               browseId.hasPrefix("LL") ||
               browseId.hasPrefix("FL") ||
               browseId.hasPrefix("OLAK") ||
               browseId.hasPrefix("UC") ||
               browseId.hasPrefix("@") {
                return nil
            }
            if let pageAnim = browseEndpoint["pageAnimation"] as? [String: Any],
               let preload = pageAnim["preloadPageConfig"] as? [String: Any],
               let ghost = preload["ghostState"] as? String,
               ghost == "GHOST_STATE_EPISODIC_SHOW_PAGE" {
                return nil
            }
            if onSelect?["watchEndpoint"] == nil {
                return nil
            }
        }

        let header = dict["header"] as? [String: Any]
        let tileHeader = header?["tileHeaderRenderer"] as? [String: Any]
        let overlays = (tileHeader?["thumbnailOverlays"] as? [[String: Any]]) ?? (dict["thumbnailOverlays"] as? [[String: Any]]) ?? []

        for ov in overlays {
            if ov["thumbnailOverlayStackingEffectRenderer"] != nil {
                return nil
            }
            if let timeStatus = ov["thumbnailOverlayTimeStatusRenderer"] as? [String: Any] {
                let text = (extractRunsText(timeStatus["text"]) ?? "").lowercased()
                if text.contains("episode") || text.contains("video") {
                    return nil
                }
            }
        }

        var videoId = ""
        if let watchEndpoint = onSelect?["watchEndpoint"] as? [String: Any],
           let vid = watchEndpoint["videoId"] as? String {
            videoId = vid
        } else if let contentId = dict["contentId"] as? String {
            videoId = contentId
        }
        
        guard !videoId.isEmpty,
              !videoId.hasPrefix("VL"),
              !videoId.hasPrefix("PL"),
              !videoId.hasPrefix("RD"),
              !videoId.hasPrefix("UU"),
              !videoId.hasPrefix("LL"),
              !videoId.hasPrefix("FL"),
              !videoId.hasPrefix("OLAK"),
              !videoId.hasPrefix("UC"),
              !videoId.hasPrefix("@") else {
            return nil
        }
        
        let meta = dict["metadata"] as? [String: Any]
        let tileMeta = meta?["tileMetadataRenderer"] as? [String: Any]
        
        let title = extractRunsText(tileMeta?["title"]) ?? extractRunsText(tileHeader?["title"]) ?? ""
        
        var channelTitle = ""
        var channelId: String? = nil
        var views = ""
        var publishedAt = ""
        
        if let lines = tileMeta?["lines"] as? [[String: Any]] {
            for line in lines {
                guard let lineRenderer = line["lineRenderer"] as? [String: Any],
                      let items = lineRenderer["items"] as? [[String: Any]] else { continue }
                for it in items {
                    guard let lineItem = it["lineItemRenderer"] as? [String: Any] else { continue }
                    let text = extractRunsText(lineItem["text"]) ?? ""
                    if text.isEmpty { continue }
                    
                    let nav = lineItem["navigationEndpoint"] as? [String: Any]
                    if let browse = nav?["browseEndpoint"] as? [String: Any],
                       let bId = browse["browseId"] as? String,
                       bId.hasPrefix("UC") || bId.hasPrefix("@") {
                        if channelTitle.isEmpty { channelTitle = text }
                        if channelId == nil { channelId = bId }
                        continue
                    }
                    
                    let lower = text.lowercased()
                    if lower.contains("view") || lower.contains("watching") {
                        if views.isEmpty { views = text }
                    } else if lower.contains("ago") || lower.contains("streamed") || lower.contains("premiered") {
                        if publishedAt.isEmpty { publishedAt = text }
                    } else if channelTitle.isEmpty && !["new", "cc", "4k", "hd", "shorts"].contains(lower.trimmingCharacters(in: .whitespacesAndNewlines)) {
                        channelTitle = text
                    }
                }
            }
        }
        
        var duration = ""
        var isShort = false
        for ov in overlays {
            if let timeStatus = ov["thumbnailOverlayTimeStatusRenderer"] as? [String: Any] {
                let style = timeStatus["style"] as? String ?? ""
                let text = extractRunsText(timeStatus["text"]) ?? ""
                if style.uppercased() == "SHORTS" || text.uppercased() == "SHORTS" {
                    isShort = true
                } else if duration.isEmpty && !text.isEmpty {
                    duration = text
                }
            }
        }
        
        var thumbUrl: URL? = nil
        let thumbs = (tileHeader?["thumbnail"] as? [String: Any])?["thumbnails"] as? [[String: Any]] ??
                     (dict["thumbnail"] as? [String: Any])?["thumbnails"] as? [[String: Any]]
        if let best = thumbs?.last?["url"] as? String {
            thumbUrl = URL(string: best)
        }
        if thumbUrl == nil {
            thumbUrl = URL(string: "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg")
        }
        
        return VideoItem(
            id: videoId,
            title: title,
            channelTitle: channelTitle,
            channelId: channelId,
            duration: duration,
            views: views,
            publishedAt: publishedAt,
            thumbnailUrl: thumbUrl,
            channelThumbnailUrl: nil,
            isShort: isShort
        )
    }
    
    private static func extractRunsText(_ obj: Any?) -> String? {
        if let str = obj as? String {
            return str
        }
        guard let dict = obj as? [String: Any] else { return nil }
        if let content = dict["content"] as? String {
            return content
        }
        if let simple = dict["simpleText"] as? String {
            return simple
        }
        if let runs = dict["runs"] as? [[String: Any]] {
            return runs.compactMap { $0["text"] as? String }.joined()
        }
        return nil
    }
    
    private static func extractSimpleText(_ obj: Any?) -> String? {
        return extractRunsText(obj)
    }
}
