import SwiftUI

/// Apple TV design tokens — compact type for 10-foot UI without oversized headings.
public enum TLTheme {
    public static let canvas = Color.black
    public static let surface = Color(white: 0.08)
    public static let surfaceElevated = Color(white: 0.12)
    
    public static let textPrimary = Color.white
    public static let textSecondary = Color(white: 0.72)
    public static let textTertiary = Color(white: 0.48)
    
    public static let accent = Color(red: 0.0, green: 0.48, blue: 1.0)
    public static let danger = Color(red: 1.0, green: 0.27, blue: 0.23)
    public static let success = Color(red: 0.19, green: 0.82, blue: 0.35)
    public static let warning = Color(red: 1.0, green: 0.62, blue: 0.04)
    
    public static let pageInset: CGFloat = 60
    public static let gridColumns = 4
    public static let gridGap: CGFloat = 28
    public static let cardSpacing: CGFloat = 28
    public static let relatedCardWidth: CGFloat = 320
    
    public static let radiusThumb: CGFloat = 10
    public static let spring = Animation.spring(response: 0.32, dampingFraction: 0.86)
}

public extension View {
    /// Kill the system white focus glow/halo; callers draw their own ring.
    func tlNoSystemFocus() -> some View {
        self.focusEffectDisabled(true)
    }
}

/// Neutral button style — no tvOS card chrome / white focus plate.
public struct TLBareButtonStyle: ButtonStyle {
    public init() {}
    
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.92 : 1)
    }
}

public struct TLButton: View {
    public enum Kind { case primary, secondary }
    
    let title: String
    let kind: Kind
    let systemImage: String?
    let action: () -> Void
    
    public init(
        _ title: String,
        kind: Kind = .primary,
        systemImage: String? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.kind = kind
        self.systemImage = systemImage
        self.action = action
    }
    
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
            .font(.callout.weight(.semibold))
        }
        .buttonStyle(.borderedProminent)
        .tint(kind == .primary ? TLTheme.accent : TLTheme.surfaceElevated)
    }
}

public struct TLBrandMark: View {
    var compact: Bool = false
    
    public init(compact: Bool = false) {
        self.compact = compact
    }
    
    public var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "play.tv.fill")
                .font(.system(size: compact ? 20 : 24, weight: .semibold))
                .foregroundStyle(TLTheme.accent)
            Text("TubeLite")
                .font(.system(size: compact ? 22 : 26, weight: .bold))
                .foregroundColor(TLTheme.textPrimary)
        }
        .accessibilityLabel("TubeLite")
    }
}

public struct TLEmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    
    public var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .medium))
                .foregroundColor(TLTheme.textTertiary)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundColor(TLTheme.textPrimary)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.callout)
                .foregroundColor(TLTheme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 640)
            if let actionTitle, let action {
                TLButton(actionTitle, kind: .secondary, action: action)
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
        .padding(.horizontal, TLTheme.pageInset)
    }
}
