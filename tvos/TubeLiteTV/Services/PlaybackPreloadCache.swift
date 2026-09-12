import Foundation

/// Focus-dwell preload: resolve streams while the user hovers a card so play starts instantly.
@MainActor
public final class PlaybackPreloadCache {
    public static let shared = PlaybackPreloadCache()
    
    private struct Entry {
        let resolution: TubeLiteGatewayClient.PlaybackResolution
        let storedAt: Date
    }
    
    private var entries: [String: Entry] = [:]
    private var inflight: [String: Task<TubeLiteGatewayClient.PlaybackResolution, Never>] = [:]
    private let ttl: TimeInterval = 8 * 60
    private let maxEntries = 6
    
    public func preload(videoId: String) {
        guard !videoId.isEmpty else { return }
        if let entry = entries[videoId], Date().timeIntervalSince(entry.storedAt) < ttl {
            return
        }
        if inflight[videoId] != nil { return }
        
        let task = Task { [weak self] in
            let resolution = await TubeLiteGatewayClient.shared.resolvePlaybackItem(videoId: videoId)
            await MainActor.run {
                guard let self else { return }
                self.inflight[videoId] = nil
                guard !Task.isCancelled else { return }
                guard resolution.isPlayable || resolution.error != nil else { return }
                self.store(videoId: videoId, resolution: resolution)
            }
            return resolution
        }
        inflight[videoId] = task
    }
    
    /// Prefer a warm cache / in-flight resolve; otherwise fetch fresh.
    /// If an in-flight task was cancelled, its error is discarded and a fresh resolve runs.
    public func resolution(for videoId: String) async -> TubeLiteGatewayClient.PlaybackResolution {
        if let entry = entries[videoId], Date().timeIntervalSince(entry.storedAt) < ttl {
            return entry.resolution
        }
        if let task = inflight[videoId] {
            let result = await task.value
            // Cancelled preloads return "Preload cancelled" — don't surface that to the user,
            // just fall through to a fresh resolve.
            if result.isPlayable || result.requiresAuth {
                return result
            }
            if let error = result.error, error.lowercased().contains("cancelled") {
                // Fall through to fresh resolve.
            } else {
                return result
            }
        }
        let resolution = await TubeLiteGatewayClient.shared.resolvePlaybackItem(videoId: videoId)
        store(videoId: videoId, resolution: resolution)
        return resolution
    }
    
    public func invalidate(videoId: String) {
        entries.removeValue(forKey: videoId)
        inflight[videoId]?.cancel()
        inflight[videoId] = nil
    }
    
    /// Cancel an in-flight preload without removing any cached result.
    /// Use on defocus: stop wasting bandwidth, but keep resolved data for instant playback.
    /// Does NOT nil out the inflight entry — if the resolve completed before cancellation
    /// took effect, resolution(for:) can still await the good result.
    public func cancelInflight(videoId: String) {
        inflight[videoId]?.cancel()
    }
    
    /// Cancel every in-flight preload — call when navigating away so stale resolves
    /// don't tie up the network or block MainActor continuations.
    public func cancelAll() {
        for (_, task) in inflight { task.cancel() }
        inflight.removeAll()
    }
    
    private func store(videoId: String, resolution: TubeLiteGatewayClient.PlaybackResolution) {
        entries[videoId] = Entry(resolution: resolution, storedAt: Date())
        if entries.count > maxEntries {
            let sorted = entries.sorted { $0.value.storedAt < $1.value.storedAt }
            for old in sorted.prefix(entries.count - maxEntries) {
                entries.removeValue(forKey: old.key)
            }
        }
    }
}
