import Foundation
import VideoToolbox

/// Network service communicating with the LiteTube Cloudflare Worker Gateway
@MainActor
public class TubeLiteGatewayClient: ObservableObject {
    public static let shared = TubeLiteGatewayClient()
    
    public static let defaultGatewayUrl = "https://litetube-gateway.anirudhkumar.workers.dev"
    
    @Published public var homeVideos: [VideoItem] = []
    @Published public var searchResults: [VideoItem] = []
    @Published public var isLoading: Bool = false
    @Published public var isLoadingMore: Bool = false
    @Published public var errorMessage: String? = nil
    
    @Published public var homeContinuationToken: String? = nil
    @Published public var searchContinuationToken: String? = nil
    @Published public var hasBridgedToSubscriptions: Bool = false
    
    private let session: URLSession
    
    public init(session: URLSession = .shared) {
        self.session = session
    }
    
    // MARK: - Playback Resolution
    
    public struct PlaybackDiagnostics: Identifiable {
        public let id = UUID()
        public var timestamp: Date = Date()
        public var videoId: String
        
        public var primaryEndpoint: String = ""
        public var primaryHttpStatus: Int? = nil
        public var primaryPlayabilityStatus: String? = nil
        public var primaryPlayabilityReason: String? = nil
        
        public var resolvedUrl: String? = nil
        public var failureStage: String? = nil
        public var executionTimeline: [String] = []
        
        public init(videoId: String) {
            self.videoId = videoId
        }
        
        public mutating func log(_ message: String) {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss.SSS"
            let timeStr = formatter.string(from: Date())
            executionTimeline.append("[\(timeStr)] \(message)")
        }
    }
    
    /// H.264 / AAC adaptive stream extracted from YouTube `adaptiveFormats` (legacy / diagnostics).
    public struct AdaptiveStream: Identifiable {
        public var id: String { "\(itag ?? 0)-\(url.absoluteString)" }
        public let url: URL
        public let itag: Int?
        public let mimeType: String
        public let codecs: String?
        public let bandwidth: Int
        public let averageBitrate: Int?
        public let width: Int?
        public let height: Int?
        public let fps: Int?
        public let approxDurationMs: Double?
    }
    
    /// Playback package: filtered HLS + optional separate A/V URLs for max-res composition (4K AV1).
    public struct PlaybackResolution {
        public let filteredHLSMaster: String?
        public let progressiveURL: URL?
        public let compositionVideoURL: URL?
        public let compositionAudioURL: URL?
        public let selectedHeight: Int
        public let selectedCodec: String?
        public let durationSeconds: Double
        public let error: String?
        public let requiresAuth: Bool
        public let diagnostics: PlaybackDiagnostics
        
        public var isPlayable: Bool {
            error == nil && (
                filteredHLSMaster != nil
                || progressiveURL != nil
                || (compositionVideoURL != nil && compositionAudioURL != nil)
            )
        }
        
        public init(
            filteredHLSMaster: String? = nil,
            progressiveURL: URL? = nil,
            compositionVideoURL: URL? = nil,
            compositionAudioURL: URL? = nil,
            selectedHeight: Int = 0,
            selectedCodec: String? = nil,
            durationSeconds: Double = 0,
            error: String? = nil,
            requiresAuth: Bool = false,
            diagnostics: PlaybackDiagnostics
        ) {
            self.filteredHLSMaster = filteredHLSMaster
            self.progressiveURL = progressiveURL
            self.compositionVideoURL = compositionVideoURL
            self.compositionAudioURL = compositionAudioURL
            self.selectedHeight = selectedHeight
            self.selectedCodec = selectedCodec
            self.durationSeconds = durationSeconds
            self.error = error
            self.requiresAuth = requiresAuth
            self.diagnostics = diagnostics
        }
    }
    
    /// Resolves AVPlayer-compatible playback at the highest safe quality.
    /// - HLS: H.264 up to 1080p (YouTube's HLS 1440/4K is VP9-only — AVPlayer can't decode VP9).
    /// - Composition: AV1 adaptive (4K/1440) when the Apple TV has AV1 hardware.
    /// Never attach TV OAuth to the IOS player client (400/401).
    public func resolvePlaybackItem(videoId: String) async -> PlaybackResolution {
        let clientKey = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc"
        let clientVersion = "20.10.4"
        let userAgent = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)"
        let clientContext: [String: Any] = [
            "clientName": "IOS",
            "clientVersion": clientVersion,
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "osName": "iOS",
            "osVersion": "17.5.1.21F90",
            "hl": "en",
            "gl": "US"
        ]
        
        var diagnostics = PlaybackDiagnostics(videoId: videoId)
        let signedIn = DeviceAuthService.shared.isSignedIn
        let allowAV1 = Self.deviceSupportsAV1()
        diagnostics.log("IOS player (no OAuth). AV1 HW=\(allowAV1). Signed in for feeds: \(signedIn)")
        
        let endpoint = "https://www.youtube.com/youtubei/v1/player?key=\(clientKey)&prettyPrint=false"
        diagnostics.primaryEndpoint = endpoint
        
        guard let url = URL(string: endpoint) else {
            diagnostics.failureStage = "Endpoint Construction"
            return PlaybackResolution(error: "Invalid YouTube player endpoint URL", diagnostics: diagnostics)
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("5", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(clientVersion, forHTTPHeaderField: "X-YouTube-Client-Version")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        
        let payload: [String: Any] = [
            "context": ["client": clientContext],
            "videoId": videoId,
            "contentCheckOk": true,
            "racyCheckOk": true,
            "playbackContext": [
                "contentPlaybackContext": ["html5Preference": "HTML5_PREF_WANTS"]
            ]
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            diagnostics.log("Sent POST to InnerTube player endpoint")
            let (data, response) = try await session.data(for: request)
            
            guard let httpRes = response as? HTTPURLResponse else {
                diagnostics.failureStage = "No HTTP Response"
                return PlaybackResolution(error: "No HTTP response received from YouTube", diagnostics: diagnostics)
            }
            
            diagnostics.primaryHttpStatus = httpRes.statusCode
            
            if httpRes.statusCode != 200 {
                let isAuthError = httpRes.statusCode == 401 || httpRes.statusCode == 403
                diagnostics.failureStage = "HTTP \(httpRes.statusCode)"
                let apiMessage = Self.googleAPIErrorMessage(from: data)
                diagnostics.log(apiMessage ?? "No Google API error body")
                return PlaybackResolution(
                    error: apiMessage ?? "YouTube returned HTTP \(httpRes.statusCode) status",
                    requiresAuth: isAuthError,
                    diagnostics: diagnostics
                )
            }
            
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                diagnostics.failureStage = "JSON Deserialization Failed"
                return PlaybackResolution(error: "Failed to parse YouTube player JSON", diagnostics: diagnostics)
            }
            
            if let playability = json["playabilityStatus"] as? [String: Any] {
                let status = playability["status"] as? String ?? ""
                diagnostics.primaryPlayabilityStatus = status
                diagnostics.log("Playability status: \(status)")
                if status != "OK" {
                    let reason = playability["reason"] as? String ?? "Video cannot be played directly (\(status))"
                    diagnostics.primaryPlayabilityReason = reason
                    diagnostics.failureStage = "Playability: \(status)"
                    let requiresAuth = (status == "LOGIN_REQUIRED")
                        || reason.lowercased().contains("sign in")
                        || reason.lowercased().contains("bot")
                    return PlaybackResolution(error: reason, requiresAuth: requiresAuth, diagnostics: diagnostics)
                }
            }
            
            guard let streamingData = json["streamingData"] as? [String: Any] else {
                diagnostics.failureStage = "Missing StreamingData"
                return PlaybackResolution(error: "No streamingData found in YouTube response", diagnostics: diagnostics)
            }
            
            let durationSeconds = Self.parseDurationSeconds(json: json, streamingData: streamingData)
            let adaptivePick = Self.pickBestAdaptivePair(from: streamingData, allowAV1: allowAV1)
            if let pick = adaptivePick {
                diagnostics.log("Best adaptive: \(pick.video.height ?? 0)p \(pick.video.codecs ?? pick.video.mimeType)")
            }
            
            var filteredMaster: String?
            var hlsMaxHeight = 0
            if let hlsURLString = streamingData["hlsManifestUrl"] as? String,
               let hlsURL = URL(string: hlsURLString) {
                diagnostics.log("Fetching HLS master (avc1\(allowAV1 ? "+av01" : ""))")
                var hlsReq = URLRequest(url: hlsURL)
                hlsReq.setValue(userAgent, forHTTPHeaderField: "User-Agent")
                let (hlsData, hlsRes) = try await session.data(for: hlsReq)
                let hlsStatus = (hlsRes as? HTTPURLResponse)?.statusCode ?? -1
                diagnostics.log("HLS master HTTP \(hlsStatus)")
                if hlsStatus == 200, let master = String(data: hlsData, encoding: .utf8),
                   let filtered = TubeLiteResourceLoader.filterHLSMaster(master, allowAV1: allowAV1) {
                    filteredMaster = filtered.playlist
                    hlsMaxHeight = filtered.maxHeight
                    diagnostics.resolvedUrl = hlsURLString
                    diagnostics.log("Filtered HLS: \(filtered.variantCount) variants, max \(filtered.maxHeight)p")
                }
            } else {
                diagnostics.log("No hlsManifestUrl in streamingData")
            }
            
            // Prefer A/V composition only when it clearly beats filtered HLS (AV1 1440/4K).
            // Never choose composition solely because HLS is missing — remote composition often
            // fails and used to surface a dead-end "No playable URL" with no progressive fallback.
            let adaptiveHeight = adaptivePick?.video.height ?? 0
            let adaptiveCodec = (adaptivePick?.video.codecs ?? adaptivePick?.video.mimeType ?? "").lowercased()
            let adaptiveIsAV1 = adaptiveCodec.contains("av01")
            let compositionBeatsHLS = adaptiveHeight > hlsMaxHeight
                && adaptiveHeight >= 1440
                && adaptiveIsAV1
            
            if let pick = adaptivePick, compositionBeatsHLS {
                diagnostics.log("Using \(adaptiveHeight)p AV1 composition (above HLS max \(hlsMaxHeight)p)")
                diagnostics.resolvedUrl = pick.video.url.absoluteString
                // Keep progressive handy when HLS isn't available as a soft fallback.
                var progressiveURL: URL?
                if filteredMaster == nil {
                    progressiveURL = await Self.resolveAndroidProgressive(videoId: videoId, session: session)?.url
                    if progressiveURL != nil {
                        diagnostics.log("Also resolved progressive fallback")
                    }
                }
                return PlaybackResolution(
                    filteredHLSMaster: filteredMaster,
                    progressiveURL: progressiveURL,
                    compositionVideoURL: pick.video.url,
                    compositionAudioURL: pick.audio.url,
                    selectedHeight: adaptiveHeight,
                    selectedCodec: pick.video.codecs ?? pick.video.mimeType,
                    durationSeconds: durationSeconds,
                    diagnostics: diagnostics
                )
            }
            
            if let filteredMaster {
                return PlaybackResolution(
                    filteredHLSMaster: filteredMaster,
                    compositionVideoURL: adaptivePick?.video.url,
                    compositionAudioURL: adaptivePick?.audio.url,
                    selectedHeight: hlsMaxHeight,
                    selectedCodec: "avc1 HLS",
                    durationSeconds: durationSeconds,
                    diagnostics: diagnostics
                )
            }
            
            // No usable HLS — prefer ANDROID muxed progressive over fragile remote composition.
            if let progressive = await Self.resolveAndroidProgressive(videoId: videoId, session: session) {
                diagnostics.log("Fallback progressive mp4 itag=\(progressive.itag ?? 0)")
                diagnostics.resolvedUrl = progressive.url.absoluteString
                return PlaybackResolution(
                    progressiveURL: progressive.url,
                    compositionVideoURL: adaptivePick?.video.url,
                    compositionAudioURL: adaptivePick?.audio.url,
                    selectedHeight: progressive.height ?? 360,
                    selectedCodec: progressive.codecs,
                    durationSeconds: durationSeconds > 0 ? durationSeconds : (progressive.approxDurationMs.map { $0 / 1000 } ?? 0),
                    diagnostics: diagnostics
                )
            }
            
            // Last resort: composition at whatever adaptive we have.
            if let pick = adaptivePick {
                diagnostics.log("HLS/progressive missing — composition at \(adaptiveHeight)p")
                return PlaybackResolution(
                    compositionVideoURL: pick.video.url,
                    compositionAudioURL: pick.audio.url,
                    selectedHeight: adaptiveHeight,
                    selectedCodec: pick.video.codecs ?? pick.video.mimeType,
                    durationSeconds: durationSeconds,
                    diagnostics: diagnostics
                )
            }
            
            diagnostics.failureStage = "No AVC1 HLS or Progressive"
            return PlaybackResolution(
                error: "No H.264/AV1 streams available for AVPlayer",
                requiresAuth: !signedIn,
                diagnostics: diagnostics
            )
        } catch {
            diagnostics.failureStage = "Network/Parse Error: \(error.localizedDescription)"
            diagnostics.log("Player fetch threw error: \(error.localizedDescription)")
            print("[TubeLiteTV] Stream resolution network error: \(error)")
            return PlaybackResolution(
                error: "Failed to resolve streams: \(error.localizedDescription)",
                diagnostics: diagnostics
            )
        }
    }
    
    private static func deviceSupportsAV1() -> Bool {
        VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)
    }
    
    private static func pickBestAdaptivePair(
        from streamingData: [String: Any],
        allowAV1: Bool
    ) -> (video: AdaptiveStream, audio: AdaptiveStream)? {
        let parsed = parseCompatibleAdaptiveStreams(from: streamingData, allowAV1: allowAV1)
        guard let video = parsed.videos.first, let audio = parsed.audios.first else { return nil }
        return (video, audio)
    }
    
    private static func resolveAndroidProgressive(
        videoId: String,
        session: URLSession
    ) async -> AdaptiveStream? {
        let key = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"
        let ver = "20.10.38"
        let ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?key=\(key)&prettyPrint=false") else {
            return nil
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("3", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(ver, forHTTPHeaderField: "X-YouTube-Client-Version")
        request.setValue(ua, forHTTPHeaderField: "User-Agent")
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": "ANDROID",
                    "clientVersion": ver,
                    "androidSdkVersion": 34,
                    "osName": "Android",
                    "osVersion": "14",
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "videoId": videoId,
            "contentCheckOk": true,
            "racyCheckOk": true
        ]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let streamingData = json["streamingData"] as? [String: Any],
                  let formats = streamingData["formats"] as? [[String: Any]] else {
                return nil
            }
            for format in formats {
                let mime = (format["mimeType"] as? String)?.lowercased() ?? ""
                guard mime.contains("avc1"), mime.contains("mp4a"),
                      let streamURL = resolveFormatURL(from: format) else { continue }
                let approx: Double? = {
                    if let s = format["approxDurationMs"] as? String { return Double(s) }
                    if let n = format["approxDurationMs"] as? Double { return n }
                    if let n = format["approxDurationMs"] as? Int { return Double(n) }
                    return nil
                }()
                return AdaptiveStream(
                    url: streamURL,
                    itag: format["itag"] as? Int,
                    mimeType: format["mimeType"] as? String ?? mime,
                    codecs: extractCodecs(from: format["mimeType"] as? String ?? ""),
                    bandwidth: intValue(format["bitrate"]) ?? 0,
                    averageBitrate: intValue(format["averageBitrate"]),
                    width: intValue(format["width"]),
                    height: intValue(format["height"]),
                    fps: intValue(format["fps"]),
                    approxDurationMs: approx
                )
            }
        } catch {
            return nil
        }
        return nil
    }
    
    // MARK: - Adaptive Format Parsing
    
    private static let classicAvc1Itags: Set<Int> = [
        160, 133, 134, 135, 136, 137, 264, 266, 298, 299, 304, 305
    ]
    
    private static let aacItags: Set<Int> = [139, 140, 141, 256, 258, 327]
    
    private struct AdaptiveParseResult {
        let videos: [AdaptiveStream]
        let audios: [AdaptiveStream]
        let totalAdaptive: Int
        let summary: String
    }
    
    private static func parseDurationSeconds(json: [String: Any], streamingData: [String: Any]) -> Double {
        if let details = json["videoDetails"] as? [String: Any] {
            if let length = details["lengthSeconds"] as? String, let secs = Double(length), secs > 0 {
                return secs
            }
            if let lengthNum = details["lengthSeconds"] as? Double, lengthNum > 0 {
                return lengthNum
            }
            if let lengthInt = details["lengthSeconds"] as? Int, lengthInt > 0 {
                return Double(lengthInt)
            }
        }
        if let adaptive = streamingData["adaptiveFormats"] as? [[String: Any]] {
            for format in adaptive {
                if let ms = format["approxDurationMs"] as? String, let value = Double(ms), value > 0 {
                    return value / 1000.0
                }
                if let msNum = format["approxDurationMs"] as? Double, msNum > 0 {
                    return msNum / 1000.0
                }
                if let msInt = format["approxDurationMs"] as? Int, msInt > 0 {
                    return Double(msInt) / 1000.0
                }
            }
        }
        return 0
    }
    
    private static func parseCompatibleAdaptiveStreams(
        from streamingData: [String: Any],
        allowAV1: Bool = false
    ) -> AdaptiveParseResult {
        let adaptive = streamingData["adaptiveFormats"] as? [[String: Any]] ?? []
        
        var videos: [AdaptiveStream] = []
        var audios: [AdaptiveStream] = []
        var skippedCipher = 0
        var skippedIncompatible = 0
        
        for format in adaptive {
            guard let streamURL = resolveFormatURL(from: format) else {
                if format["signatureCipher"] != nil || format["cipher"] != nil {
                    skippedCipher += 1
                }
                continue
            }
            
            let mimeType = (format["mimeType"] as? String) ?? ""
            let mimeLower = mimeType.lowercased()
            let codecs = extractCodecs(from: mimeType) ?? (format["codecs"] as? String)
            let codecsLower = codecs?.lowercased() ?? ""
            let itag = format["itag"] as? Int
            
            let isAvc1 = mimeLower.contains("avc1")
                || codecsLower.contains("avc1")
                || (itag.map { classicAvc1Itags.contains($0) } ?? false)
            let isAV1 = mimeLower.contains("av01") || codecsLower.contains("av01")
            let isMp4a = mimeLower.contains("mp4a")
                || codecsLower.contains("mp4a")
                || (itag.map { aacItags.contains($0) } ?? false)
            
            // VP9 / Opus / webm never work in AVPlayer. AV1 only when HW decode exists.
            let isVP9 = mimeLower.contains("vp9") || mimeLower.contains("vp09")
                || codecsLower.contains("vp9") || codecsLower.contains("vp09")
                || mimeLower.contains("webm")
            let isOpus = codecsLower.contains("opus") || mimeLower.contains("opus")
            
            if isVP9 || isOpus || (isAV1 && !allowAV1) {
                skippedIncompatible += 1
                continue
            }
            
            let bitrate = intValue(format["bitrate"])
                ?? intValue(format["averageBitrate"])
                ?? 0
            let averageBitrate = intValue(format["averageBitrate"])
            let width = intValue(format["width"])
            let height = intValue(format["height"])
            let fps = intValue(format["fps"])
            let approxDurationMs: Double? = {
                if let s = format["approxDurationMs"] as? String { return Double(s) }
                if let n = format["approxDurationMs"] as? Double { return n }
                if let n = format["approxDurationMs"] as? Int { return Double(n) }
                return nil
            }()
            
            let stream = AdaptiveStream(
                url: streamURL,
                itag: itag,
                mimeType: mimeType,
                codecs: codecs,
                bandwidth: bitrate,
                averageBitrate: averageBitrate,
                width: width,
                height: height,
                fps: fps,
                approxDurationMs: approxDurationMs
            )
            
            let isVideo = (mimeLower.hasPrefix("video/") || height != nil) && (isAvc1 || (allowAV1 && isAV1))
            if isVideo {
                videos.append(stream)
            } else if (mimeLower.hasPrefix("audio/") || height == nil) && isMp4a {
                audios.append(stream)
            } else {
                skippedIncompatible += 1
            }
        }
        
        // Prefer taller first; at same height prefer AV1 over avc1, then bitrate.
        var bestByHeight: [Int: AdaptiveStream] = [:]
        for video in videos {
            let key = video.height ?? 0
            if let existing = bestByHeight[key] {
                let newIsAV1 = (video.codecs ?? video.mimeType).lowercased().contains("av01")
                let oldIsAV1 = (existing.codecs ?? existing.mimeType).lowercased().contains("av01")
                if newIsAV1 != oldIsAV1 {
                    if newIsAV1 { bestByHeight[key] = video }
                } else if video.bandwidth > existing.bandwidth {
                    bestByHeight[key] = video
                }
            } else {
                bestByHeight[key] = video
            }
        }
        let sortedVideos = bestByHeight.values.sorted { ($0.height ?? 0) > ($1.height ?? 0) }
        let sortedAudios = audios.sorted {
            ($0.averageBitrate ?? $0.bandwidth) > ($1.averageBitrate ?? $1.bandwidth)
        }
        
        let summary = "adaptive=\(adaptive.count) video=\(sortedVideos.count) mp4a=\(sortedAudios.count) skippedCipher=\(skippedCipher) skippedOther=\(skippedIncompatible) av1Allowed=\(allowAV1)"
        return AdaptiveParseResult(
            videos: sortedVideos,
            audios: sortedAudios,
            totalAdaptive: adaptive.count,
            summary: summary
        )
    }
    
    /// Prefer direct `url`; otherwise unwrap `signatureCipher`/`cipher` query (`url` + `sig`/`signature`).
    private static func resolveFormatURL(from format: [String: Any]) -> URL? {
        if let urlStr = format["url"] as? String, let url = URL(string: urlStr) {
            return url
        }
        
        let cipher = (format["signatureCipher"] as? String) ?? (format["cipher"] as? String)
        guard let cipher else { return nil }
        
        var components = URLComponents()
        components.percentEncodedQuery = cipher
        
        var params: [String: String] = [:]
        for item in components.queryItems ?? [] {
            if let value = item.value {
                params[item.name] = value
            }
        }
        guard var urlStr = params["url"], !urlStr.isEmpty else { return nil }
        
        if let sig = params["sig"] ?? params["signature"] {
            let separator = urlStr.contains("?") ? "&" : "?"
            urlStr += "\(separator)signature=\(sig)"
        } else if params["s"] != nil {
            // Encrypted `s` requires player JS decryption — unusable here.
            return nil
        }
        
        return URL(string: urlStr)
    }
    
    private static func intValue(_ any: Any?) -> Int? {
        if let i = any as? Int { return i }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) }
        return nil
    }
    
    private static func extractCodecs(from mimeType: String) -> String? {
        // e.g. video/mp4; codecs="avc1.640028"
        guard let range = mimeType.range(of: #"codecs="([^"]+)""#, options: .regularExpression) else {
            return nil
        }
        let matched = String(mimeType[range])
        guard let open = matched.firstIndex(of: "\""),
              let close = matched.lastIndex(of: "\""),
              open < close else {
            return nil
        }
        let start = matched.index(after: open)
        return String(matched[start..<close])
    }
    
    private static func googleAPIErrorMessage(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = json["error"] as? [String: Any] else {
            return nil
        }
        if let message = error["message"] as? String, !message.isEmpty {
            let status = error["status"] as? String
            return status.map { "\($0): \(message)" } ?? message
        }
        return nil
    }


    
    // MARK: - Browse Home Feed
    
    public func fetchHomeFeed(browseId: String = "FEwhat_to_watch") async {
        isLoading = true
        errorMessage = nil
        homeContinuationToken = nil
        hasBridgedToSubscriptions = false
        
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/browse"
        guard let url = URL(string: endpoint) else {
            isLoading = false
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let isAuth = DeviceAuthService.shared.isSignedIn && DeviceAuthService.shared.accessToken != nil
        let clientName = isAuth ? "TVHTML5" : "WEB"
        let clientVer = isAuth ? "7.20240901.00.00" : "2.20240901.00.00"
        
        request.setValue(clientName, forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(clientVer, forHTTPHeaderField: "X-YouTube-Client-Version")
        if let token = DeviceAuthService.shared.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": clientName,
                    "clientVersion": clientVer,
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "browseId": browseId
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let (parsed, token) = InnerTubeParser.parseWithContinuation(json: json)
                    self.homeContinuationToken = token
                    self.homeVideos = parsed

                    // Seamless auto-extend via Subscriptions: if signed in and recommendation pool is small (< 12),
                    // bridge to latest subscriptions immediately so the TV grid has a rich selection.
                    if isAuth && self.homeVideos.count < 12 && !self.hasBridgedToSubscriptions {
                        await self.bridgeToSubscriptions()
                    }
                }
            } else {
                self.errorMessage = "Failed to load home feed (status: \((response as? HTTPURLResponse)?.statusCode ?? 0))"
            }
        } catch {
            self.errorMessage = "Network error: \(error.localizedDescription)"
        }
        
        self.isLoading = false
    }
    
    // MARK: - Infinite Scroll (Load More Home)
    
    public func fetchMoreHomeFeed() async {
        guard !isLoadingMore else { return }
        let isAuth = DeviceAuthService.shared.isSignedIn && DeviceAuthService.shared.accessToken != nil

        // If recommendations continuation ran out, seamlessly extend via Subscriptions
        if homeContinuationToken == nil {
            if isAuth && !hasBridgedToSubscriptions {
                isLoadingMore = true
                await bridgeToSubscriptions()
                isLoadingMore = false
            }
            return
        }

        guard let token = homeContinuationToken else { return }
        isLoadingMore = true
        
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/browse"
        guard let url = URL(string: endpoint) else {
            isLoadingMore = false
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let clientName = isAuth ? "TVHTML5" : "WEB"
        let clientVer = isAuth ? "7.20240901.00.00" : "2.20240901.00.00"
        
        request.setValue(clientName, forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(clientVer, forHTTPHeaderField: "X-YouTube-Client-Version")
        if let bearer = DeviceAuthService.shared.accessToken {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": clientName,
                    "clientVersion": clientVer,
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "continuation": token
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200,
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let (newVideos, nextToken) = InnerTubeParser.parseWithContinuation(json: json)
                self.homeContinuationToken = nextToken
                
                let existingIds = Set(self.homeVideos.map { $0.id })
                let uniqueNew = newVideos.filter { !existingIds.contains($0.id) }
                self.homeVideos.append(contentsOf: uniqueNew)

                // If recommendations continuation just ran out, auto-extend to Subscriptions
                if nextToken == nil && isAuth && !self.hasBridgedToSubscriptions {
                    await self.bridgeToSubscriptions()
                }
            }
        } catch {
            print("[TubeLiteTV] Continuation error: \(error)")
        }
        
        self.isLoadingMore = false
    }

    /// Fetches latest unviewed videos from Subscriptions (FEsubscriptions) to extend home feed seamlessly
    private func bridgeToSubscriptions() async {
        guard let token = DeviceAuthService.shared.accessToken else { return }
        self.hasBridgedToSubscriptions = true
        
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/browse"
        guard let url = URL(string: endpoint) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("TVHTML5", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue("7.20240901.00.00", forHTTPHeaderField: "X-YouTube-Client-Version")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": "TVHTML5",
                    "clientVersion": "7.20240901.00.00",
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "browseId": "FEsubscriptions"
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200,
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let (subVideos, subToken) = InnerTubeParser.parseWithContinuation(json: json)
                let existingIds = Set(self.homeVideos.map { $0.id })
                let uniqueNew = subVideos.filter { !existingIds.contains($0.id) }
                self.homeVideos.append(contentsOf: uniqueNew)
                if self.homeContinuationToken == nil {
                    self.homeContinuationToken = subToken
                }
            }
        } catch {
            print("[TubeLiteTV] Subscriptions auto-extend error: \(error)")
        }
    }
    
    // MARK: - Search
    
    public func search(query: String) async {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            self.searchResults = []
            return
        }
        
        isLoading = true
        errorMessage = nil
        searchContinuationToken = nil
        
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/search"
        guard let url = URL(string: endpoint) else {
            isLoading = false
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("WEB", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue("2.20240901.00.00", forHTTPHeaderField: "X-YouTube-Client-Version")
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": "WEB",
                    "clientVersion": "2.20240901.00.00",
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "query": query,
            "params": "EgIQAQ=="
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let (parsed, token) = InnerTubeParser.parseWithContinuation(json: json)
                    self.searchContinuationToken = token
                    self.searchResults = parsed
                }
            } else {
                self.errorMessage = "Search failed"
            }
        } catch {
            self.errorMessage = "Search error: \(error.localizedDescription)"
        }
        
        self.isLoading = false
    }
    
    public func fetchMoreSearchResults() async {
        guard !isLoadingMore, let token = searchContinuationToken else { return }
        isLoadingMore = true
        
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/search"
        guard let url = URL(string: endpoint) else {
            isLoadingMore = false
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("WEB", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue("2.20240901.00.00", forHTTPHeaderField: "X-YouTube-Client-Version")
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": "WEB",
                    "clientVersion": "2.20240901.00.00",
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "continuation": token
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200,
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let (newVideos, nextToken) = InnerTubeParser.parseWithContinuation(json: json)
                searchContinuationToken = nextToken
                let existing = Set(searchResults.map(\.id))
                searchResults.append(contentsOf: newVideos.filter { !existing.contains($0.id) })
            }
        } catch {
            print("[TubeLiteTV] Search continuation error: \(error)")
        }
        
        isLoadingMore = false
    }
    
    // MARK: - Watch Next & Recommendations API
    
    public func fetchWatchNext(videoId: String) async -> (details: VideoItem?, related: [VideoItem]) {
        let endpoint = "\(Self.defaultGatewayUrl)/api/innertube/next"
        guard let url = URL(string: endpoint) else { return (nil, []) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("WEB", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue("2.20240901.00.00", forHTTPHeaderField: "X-YouTube-Client-Version")
        
        let payload: [String: Any] = [
            "context": [
                "client": [
                    "clientName": "WEB",
                    "clientVersion": "2.20240901.00.00",
                    "hl": "en",
                    "gl": "US"
                ]
            ],
            "videoId": videoId
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            
            if let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200,
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let (details, related) = InnerTubeParser.parseWatchNext(json: json)
                return (details, related)
            }
        } catch {
            print("[TubeLiteTV] Watch next error: \(error)")
        }
        
        return (nil, [])
    }
    

    
    // MARK: - SponsorBlock Segments
    
    public struct SponsorSegment: Codable {
        public let start: Double
        public let end: Double
    }
    
    public func fetchSponsorSegments(videoId: String) async -> [SponsorSegment] {
        guard let url = URL(string: "https://sponsor.ajay.app/api/skipSegments?videoID=\(videoId)&categories=%5B%22sponsor%22%2C%22selfpromo%22%2C%22interaction%22%2C%22intro%22%2C%22outro%22%5D") else {
            return []
        }
        
        do {
            let (data, response) = try await session.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let items = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return []
            }
            
            return items.compactMap { item in
                guard let seg = item["segment"] as? [Double], seg.count >= 2 else { return nil }
                return SponsorSegment(start: seg[0], end: seg[1])
            }
        } catch {
            return []
        }
    }
}
