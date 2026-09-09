import Foundation
import AVFoundation

/// Serves a filtered H.264-only HLS master playlist over a custom URL scheme.
/// Media playlist / segment URIs stay absolute `https://` googlevideo URLs so CoreMedia
/// fetches real YouTube HLS (not progressive MP4 wrapped as fake segments — that causes -12660).
public final class TubeLiteResourceLoader: NSObject, AVAssetResourceLoaderDelegate {
    public static let urlScheme = "tubelite-hls"
    
    public let masterURL: URL
    public let queue = DispatchQueue(label: "com.tubelite.tv.resource-loader")
    
    private let masterPlaylistData: Data
    
    public init(masterPlaylist: String) {
        self.masterPlaylistData = Data(masterPlaylist.utf8)
        self.masterURL = URL(string: "\(Self.urlScheme)://local/master.m3u8")!
        super.init()
    }
    
    public func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let requestURL = loadingRequest.request.url,
              requestURL.scheme == Self.urlScheme else {
            loadingRequest.finishLoading(with: Self.error("Unsupported resource URL"))
            return true
        }
        
        let path = requestURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard path.isEmpty || path == "master.m3u8" else {
            loadingRequest.finishLoading(with: Self.error("Unknown playlist path: \(path)"))
            return true
        }
        
        let data = masterPlaylistData
        
        if let contentInfo = loadingRequest.contentInformationRequest {
            contentInfo.contentType = "application/vnd.apple.mpegurl"
            contentInfo.contentLength = Int64(data.count)
            contentInfo.isByteRangeAccessSupported = true
        }
        
        if let dataRequest = loadingRequest.dataRequest {
            respond(to: dataRequest, with: data)
        }
        
        loadingRequest.finishLoading()
        return true
    }
    
    private func respond(to dataRequest: AVAssetResourceLoadingDataRequest, with data: Data) {
        let offset = Int(dataRequest.requestedOffset)
        guard offset < data.count else {
            dataRequest.respond(with: Data())
            return
        }
        let end = dataRequest.requestsAllDataToEndOfResource
            ? data.count
            : min(data.count, offset + dataRequest.requestedLength)
        dataRequest.respond(with: data.subdata(in: offset..<end))
    }
    
    /// Keep AVPlayer-safe variants: always `avc1`, plus `av01` when `allowAV1`.
    /// Drops VP9 (CoreMedia can't decode). Sorts by bandwidth ascending (HLS ABR).
    public static func filterHLSMaster(
        _ master: String,
        allowAV1: Bool
    ) -> (playlist: String, variantCount: Int, maxHeight: Int)? {
        let lines = master.components(separatedBy: .newlines)
        var header: [String] = []
        var mediaTags: [String] = []
        var variants: [(info: String, uri: String, bandwidth: Int, height: Int)] = []
        
        var i = 0
        while i < lines.count {
            let line = lines[i].trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                i += 1
                continue
            }
            if line.hasPrefix("#EXT-X-STREAM-INF:") {
                let info = line
                // Skip blank lines between STREAM-INF and URI.
                var j = i + 1
                while j < lines.count && lines[j].trimmingCharacters(in: .whitespaces).isEmpty {
                    j += 1
                }
                let uri = (j < lines.count) ? lines[j].trimmingCharacters(in: .whitespaces) : ""
                i = j + 1
                guard !uri.isEmpty, !uri.hasPrefix("#") else { continue }
                let lower = info.lowercased()
                let isAVC = lower.contains("avc1")
                let isAV1 = lower.contains("av01")
                let isVP9 = lower.contains("vp09") || lower.contains("vp9")
                let allowed = (isAVC || (allowAV1 && isAV1)) && !isVP9
                guard allowed else { continue }
                variants.append((
                    info,
                    uri,
                    attributeInt(from: info, name: "BANDWIDTH") ?? 0,
                    resolutionHeight(from: info) ?? 0
                ))
                continue
            }
            if line.hasPrefix("#EXT-X-MEDIA:") {
                mediaTags.append(line)
                i += 1
                continue
            }
            if line.hasPrefix("#EXT-X-I-FRAME-STREAM-INF:") {
                i += 1
                continue
            }
            if variants.isEmpty && mediaTags.isEmpty {
                header.append(line)
            }
            i += 1
        }
        
        guard !variants.isEmpty else { return nil }
        
        // One variant per height — keep the highest bandwidth (sharper encode / better audio).
        var bestByHeight: [Int: (info: String, uri: String, bandwidth: Int, height: Int)] = [:]
        for v in variants {
            let key = v.height
            if let existing = bestByHeight[key] {
                if v.bandwidth > existing.bandwidth { bestByHeight[key] = v }
            } else {
                bestByHeight[key] = v
            }
        }
        
        let rawMaxHeight = bestByHeight.keys.max() ?? 0
        // Prefer the top rung: when 1080+ exists, play that only (no soft 144–480 ABR crawl).
        // Otherwise keep ≥360 so mid-tier videos still have a small ladder.
        let pool: [ (info: String, uri: String, bandwidth: Int, height: Int) ]
        if rawMaxHeight >= 1080, let top = bestByHeight[rawMaxHeight] {
            pool = [top]
        } else {
            let minKeep = rawMaxHeight >= 720 ? 360 : 0
            let trimmed = bestByHeight.values.filter { $0.height >= minKeep }
            pool = trimmed.isEmpty ? Array(bestByHeight.values) : Array(trimmed)
        }
        
        // HLS authoring: ascending bandwidth; AVPlayer still ramps, but without 144/240 filler.
        let sorted = pool.sorted { $0.bandwidth < $1.bandwidth }
        let maxHeight = sorted.map(\.height).max() ?? 0
        
        var neededAudioGroups = Set<String>()
        for v in sorted {
            if let group = attributeValue(from: v.info, name: "AUDIO") {
                neededAudioGroups.insert(group)
            }
        }
        
        let keptMedia = mediaTags.filter { tag in
            let type = attributeValue(from: tag, name: "TYPE")?.uppercased()
            guard type == "AUDIO" else { return false }
            guard let group = attributeValue(from: tag, name: "GROUP-ID") else { return false }
            return neededAudioGroups.contains(group)
        }
        
        var out: [String] = header.isEmpty ? ["#EXTM3U", "#EXT-X-INDEPENDENT-SEGMENTS"] : header
        out.append(contentsOf: keptMedia)
        for v in sorted {
            out.append(stripAttribute(from: v.info, name: "SUBTITLES"))
            out.append(v.uri)
        }
        return (out.joined(separator: "\n") + "\n", sorted.count, maxHeight)
    }
    
    /// Backward-compatible alias.
    public static func filterHLSMasterForAVC1(_ master: String) -> (playlist: String, variantCount: Int)? {
        guard let r = filterHLSMaster(master, allowAV1: false) else { return nil }
        return (r.playlist, r.variantCount)
    }
    
    private static func resolutionHeight(from streamInf: String) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: #"RESOLUTION=\d+x(\d+)"#),
              let match = regex.firstMatch(in: streamInf, range: NSRange(streamInf.startIndex..<streamInf.endIndex, in: streamInf)),
              let r = Range(match.range(at: 1), in: streamInf) else {
            return nil
        }
        return Int(streamInf[r])
    }
    
    private static func attributeInt(from line: String, name: String) -> Int? {
        attributeValue(from: line, name: name).flatMap(Int.init)
    }
    
    private static func mediaGroupID(from streamInf: String, attribute: String) -> String? {
        attributeValue(from: streamInf, name: attribute)
    }
    
    private static func attributeValue(from line: String, name: String) -> String? {
        // AUDIO="233" or AUDIO=233
        let pattern = #"\#(name)=(?:"([^"]+)"|([^,\s]+))"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let match = regex.firstMatch(in: line, range: range) else { return nil }
        if let r = Range(match.range(at: 1), in: line), !r.isEmpty { return String(line[r]) }
        if let r = Range(match.range(at: 2), in: line), !r.isEmpty { return String(line[r]) }
        return nil
    }
    
    private static func stripAttribute(from line: String, name: String) -> String {
        guard line.hasPrefix("#EXT-X-STREAM-INF:") else { return line }
        let prefix = "#EXT-X-STREAM-INF:"
        let body = String(line.dropFirst(prefix.count))
        let parts = splitHLSAttributes(body).filter {
            !$0.uppercased().hasPrefix("\(name.uppercased())=")
        }
        return prefix + parts.joined(separator: ",")
    }
    
    private static func splitHLSAttributes(_ body: String) -> [String] {
        var parts: [String] = []
        var current = ""
        var inQuotes = false
        for ch in body {
            if ch == "\"" {
                inQuotes.toggle()
                current.append(ch)
            } else if ch == "," && !inQuotes {
                let trimmed = current.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { parts.append(trimmed) }
                current = ""
            } else {
                current.append(ch)
            }
        }
        let trimmed = current.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { parts.append(trimmed) }
        return parts
    }
    
    private static func error(_ message: String) -> NSError {
        NSError(
            domain: "TubeLiteResourceLoader",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
