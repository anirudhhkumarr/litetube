import SwiftUI

/// Full-screen TV account / device pairing.
public struct AccountTabView: View {
    @ObservedObject private var auth = DeviceAuthService.shared
    @State private var didStart = false
    
    public init() {}
    
    public var body: some View {
        ZStack {
            TLTheme.canvas.ignoresSafeArea()
            
            VStack(spacing: 24) {
                TLBrandMark()
                
                if auth.isSignedIn {
                    signedIn
                } else {
                    signedOut
                }
            }
            .frame(maxWidth: 720)
            .padding(36)
        }
        .task {
            guard !auth.isSignedIn, !didStart else { return }
            didStart = true
            await auth.startDeviceAuth()
        }
    }
    
    private var signedIn: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44))
                .foregroundColor(TLTheme.success)
            
            Text("Signed in to YouTube")
                .font(.title3.weight(.semibold))
                .foregroundColor(TLTheme.textPrimary)
            
            Text("Your home feed uses personalized recommendations.")
                .font(.callout)
                .foregroundColor(TLTheme.textSecondary)
                .multilineTextAlignment(.center)
            
            TLButton("Sign Out", kind: .secondary) {
                auth.signOut()
                didStart = false
            }
        }
    }
    
    private var signedOut: some View {
        VStack(spacing: 18) {
            Text("Sign in with Google")
                .font(.title3.weight(.semibold))
                .foregroundColor(TLTheme.textPrimary)
            
            Text("On your phone or computer, open google.com/device and enter this code:")
                .font(.callout)
                .foregroundColor(TLTheme.textSecondary)
                .multilineTextAlignment(.center)
            
            if auth.userCode.isEmpty {
                ProgressView("Generating code…")
                    .padding(.vertical, 16)
            } else {
                Text(auth.userCode)
                    .font(.system(size: 40, weight: .bold, design: .monospaced))
                    .tracking(8)
                    .foregroundColor(TLTheme.textPrimary)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 20)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(TLTheme.surface)
                    )
            }
            
            if auth.isPolling {
                ProgressView("Waiting for authorization…")
            }
            
            if let error = auth.authError {
                Text(error)
                    .font(.callout)
                    .foregroundColor(TLTheme.danger)
                    .multilineTextAlignment(.center)
                
                TLButton("Try Again", kind: .secondary) {
                    Task { await auth.startDeviceAuth() }
                }
            }
        }
    }
}
