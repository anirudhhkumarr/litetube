# TubeLite for Apple TV (tvOS)

A native **SwiftUI Apple TV application** for TubeLite designed for the 10-foot living room experience.

- **100% Native tvOS UI**: Built with SwiftUI, utilizing the Siri Remote focus engine with fluid scaling and specular highlights.
- **Hardware-Accelerated 4K/HDR Playback**: Plays native HLS and MP4 streams via `AVPlayerViewController`.
- **Integrated SponsorBlock Engine**: Automatically detects and skips sponsor segments in real time during playback.
- **Cloudflare Worker Gateway Backend**: Connects directly to `https://litetube-gateway.anirudhkumar.workers.dev` with per-client 30s caching and rate-limit delay retries.
- **App Store & TestFlight Ready**: Complies with Apple's strict tvOS App Store guidelines (no full webviews).

---

## Project Structure

```
tvos/
├── TubeLiteTV.xcodeproj/       # Xcode Project (Open directly in Xcode)
│   └── project.pbxproj
└── TubeLiteTV/
    ├── TubeLiteTVApp.swift      # App entry point with TabView navigation
    ├── Info.plist               # tvOS configuration & network permissions
    ├── Models/
    │   └── VideoItem.swift      # Data models & InnerTube JSON parser
    ├── Services/
    │   └── TubeLiteGatewayClient.swift # Gateway API Client (Browse, Search, Player)
    └── Views/
        ├── HomeFeedView.swift   # 3-column 1080p/4K TV video shelf
        ├── VideoCardView.swift  # Remote focus card with hover zoom & glow
        ├── SearchView.swift     # Siri Remote dictation & on-screen search
        └── PlayerView.swift     # AVPlayer with remote transport & SponsorBlock
```

---

## Step-by-Step Setup & Running

### 1. Prerequisites on Your Mac
1. Install **Xcode** (version 15.0 or later) from the Mac App Store.
2. Ensure you have an Apple ID (free or paid developer account).

### 2. Open the Project in Xcode
From your terminal:
```bash
open tvos/TubeLiteTV.xcodeproj
```
Or open Xcode, click **Open Existing Project**, and select `tvos/TubeLiteTV.xcodeproj`.

---

## Running in Dev Mode on Apple TV

### Method A: Apple TV Simulator (Instant, No TV Required)
1. In Xcode, at the top toolbar next to `TubeLiteTV`, click the target device dropdown.
2. Select any **Apple TV 4K** or **Apple TV** simulator.
3. Press **Cmd + R** (or click the **Play** button).
4. Xcode will compile and launch the simulator. Use the on-screen Siri Remote (`Window` -> `Show Remote`) to navigate!

### Method B: Physical Apple TV (Over Local Wi-Fi)

#### 1. Enable Developer Mode on Apple TV:
- On your Apple TV: Go to **Settings** → **Privacy & Security** → scroll to the bottom and select **Developer Mode**.
- Toggle it **ON** and restart the Apple TV when prompted.

#### 2. Pair Apple TV with Xcode:
- Connect your Mac and Apple TV to the **same Wi-Fi network**.
- On your Apple TV: Go to **Settings** → **Remotes and Devices** → **Remote App and Devices**.
- On your Mac in Xcode: Go to **Window** → **Devices and Simulators** (`Cmd + Shift + 2`).
- Select your Apple TV in the left sidebar and click **Pair**.
- Enter the 6-digit pin displayed on your TV screen.

#### 3. Code Signing in Xcode:
- In Xcode's project navigator, click the root **TubeLiteTV** project.
- Select the **TubeLiteTV** target under "Targets".
- Go to the **Signing & Capabilities** tab.
- Check **Automatically manage signing**.
- Under **Team**, select your Personal Apple ID account (e.g. `Your Name (Personal Team)`).
- If needed, change the **Bundle Identifier** to something unique like `com.yourname.tubelite.tv`.

#### 4. Run on Apple TV:
- Select your physical Apple TV in Xcode's device selector at the top.
- Press **Cmd + R** to build and install.
- The TubeLite icon will appear on your Apple TV home screen!

---

## Publishing to the tvOS App Store or TestFlight

If you have an Apple Developer Program membership ($99/year):

1. **App Store Connect Setup**:
   - Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com).
   - Click **My Apps** → **+** → **New App**.
   - Select platform: **tvOS**.
   - Select your Bundle ID (`com.tubelite.tv`).

2. **Archive the App in Xcode**:
   - In Xcode, select the build target as **Any tvOS Device (arm64)**.
   - Go to menu: **Product** → **Archive**.
   - Once compilation finishes, the Xcode Organizer window will pop up.

3. **Upload to TestFlight / App Store**:
   - Click **Distribute App** in the Organizer.
   - Choose **App Store Connect** → **Upload**.
   - Follow the prompts to upload the build.

4. **TestFlight Beta Testing**:
   - Within 5–10 minutes of upload, your build will appear in App Store Connect under the **TestFlight** tab.
   - You can add yourself and testers by Apple ID to install via the **TestFlight app on Apple TV**.

5. **Submit for App Review**:
   - Prepare your tvOS screenshots (1920×1080 or 3840×2160 pixels).
   - Add app description and privacy policy.
   - Submit for Apple Review.
