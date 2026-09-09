import Foundation
import SwiftUI

/// Google YouTube TV OAuth 2.0 Device Flow Service for Apple TV
@MainActor
public class DeviceAuthService: ObservableObject {
    public static let shared = DeviceAuthService()
    
    public static let clientId = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com"
    public static let clientSecret = "SboVhoG9s0rNafixCSGGKXAT"
    public static let scope = "https://www.googleapis.com/auth/youtube"
    
    public static let deviceCodeUrl = "https://oauth2.googleapis.com/device/code"
    public static let tokenUrl = "https://oauth2.googleapis.com/token"
    
    @Published public var isSignedIn: Bool = false
    @Published public var userCode: String = ""
    @Published public var verificationUrl: String = "https://www.google.com/device"
    @Published public var isPolling: Bool = false
    @Published public var authError: String? = nil
    @Published public var accessToken: String? = nil
    
    private var pollTask: Task<Void, Never>? = nil
    
    private let tokenKey = "tubelite_tv_access_token"
    private let refreshTokenKey = "tubelite_tv_refresh_token"
    
    public init() {
        loadSavedSession()
    }
    
    public func loadSavedSession() {
        if let token = UserDefaults.standard.string(forKey: tokenKey), !token.isEmpty {
            self.accessToken = token
            self.isSignedIn = true
        } else {
            self.isSignedIn = false
            self.accessToken = nil
        }
    }
    
    // MARK: - Start Device Code Flow
    
    public func startDeviceAuth() async {
        self.authError = nil
        self.isPolling = true
        self.userCode = ""
        
        guard let url = URL(string: Self.deviceCodeUrl) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        
        let bodyString = "client_id=\(Self.clientId)&scope=\(Self.scope)"
        request.httpBody = bodyString.data(using: .utf8)
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let deviceCode = json["device_code"] as? String,
                  let userCode = json["user_code"] as? String else {
                self.authError = "Failed to initiate sign-in"
                self.isPolling = false
                return
            }
            
            self.userCode = userCode
            if let verUrl = json["verification_url"] as? String {
                self.verificationUrl = verUrl
            }
            
            let interval = (json["interval"] as? Double) ?? 5.0
            startPolling(deviceCode: deviceCode, intervalSec: interval)
        } catch {
            self.authError = "Network error: \(error.localizedDescription)"
            self.isPolling = false
        }
    }
    
    // MARK: - Polling for Token
    
    private func startPolling(deviceCode: String, intervalSec: Double) {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            let startTime = Date()
            var currentInterval = intervalSec
            
            while Date().timeIntervalSince(startTime) < 1800 {
                try? await Task.sleep(nanoseconds: UInt64(currentInterval * 1_000_000_000))
                if Task.isCancelled { return }
                
                guard let self = self else { return }
                
                guard let url = URL(string: Self.tokenUrl) else { return }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                
                let bodyString = "client_id=\(Self.clientId)&client_secret=\(Self.clientSecret)&code=\(deviceCode)&grant_type=http://oauth.net/grant_type/device/1.0"
                request.httpBody = bodyString.data(using: .utf8)
                
                do {
                    let (data, response) = try await URLSession.shared.data(for: request)
                    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        continue
                    }
                    
                    if (response as? HTTPURLResponse)?.statusCode == 200,
                       let accessToken = json["access_token"] as? String {
                        self.accessToken = accessToken
                        self.isSignedIn = true
                        self.isPolling = false
                        UserDefaults.standard.set(accessToken, forKey: self.tokenKey)
                        if let refreshToken = json["refresh_token"] as? String {
                            UserDefaults.standard.set(refreshToken, forKey: self.refreshTokenKey)
                        }
                        return
                    }
                    
                    if let err = json["error"] as? String {
                        if err == "authorization_pending" {
                            continue
                        } else if err == "slow_down" {
                            currentInterval += 2.0
                            continue
                        } else if err == "access_denied" {
                            self.authError = "Sign-in was denied on Google"
                            self.isPolling = false
                            return
                        } else {
                            self.authError = "Sign-in expired or failed: \(err)"
                            self.isPolling = false
                            return
                        }
                    }
                } catch {
                    // Network glitch: continue polling
                    continue
                }
            }
            
            self?.authError = "Sign-in timed out. Please try again."
            self?.isPolling = false
        }
    }
    
    // MARK: - Sign Out
    
    public func signOut() {
        pollTask?.cancel()
        pollTask = nil
        self.accessToken = nil
        self.isSignedIn = false
        self.userCode = ""
        self.isPolling = false
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: refreshTokenKey)
    }
    
    public func cancel() {
        pollTask?.cancel()
        pollTask = nil
        self.isPolling = false
        self.userCode = ""
    }
}
