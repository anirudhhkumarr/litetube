import SwiftUI

/// Root shell. Home/Search use vertical grids; selection opens WatchView (hero + related, play = fullscreen).
public struct MainView: View {
    @StateObject private var auth = DeviceAuthService.shared
    @State private var selectedVideo: VideoItem?
    @State private var selectedTab = 0
    
    public init() {}
    
    public var body: some View {
        TabView(selection: $selectedTab) {
            HomeFeedView(onSelect: { selectedVideo = $0 })
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(0)
            
            SearchFeedView(onSelect: { selectedVideo = $0 })
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(1)
            
            AccountTabView()
                .tabItem { Label(auth.isSignedIn ? "Account" : "Sign In", systemImage: "person.crop.circle") }
                .tag(2)
        }
        .fullScreenCover(item: $selectedVideo) { video in
            WatchView(
                video: video,
                onOpenAccount: {
                    selectedVideo = nil
                    selectedTab = 2
                },
                onDismiss: { selectedVideo = nil }
            )
        }
    }
}

// MARK: - Home (vertical scroll grid)

private struct HomeFeedView: View {
    @StateObject private var client = TubeLiteGatewayClient.shared
    @StateObject private var auth = DeviceAuthService.shared
    let onSelect: (VideoItem) -> Void
    
    private var videos: [VideoItem] {
        client.homeVideos.filter { !$0.isShort }
    }
    
    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TLTheme.gridGap, alignment: .top),
            count: TLTheme.gridColumns
        )
    }
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                header
                    .padding(.horizontal, TLTheme.pageInset)
                    .padding(.top, 16)
                
                if client.isLoading && videos.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else if let error = client.errorMessage, videos.isEmpty {
                    TLEmptyState(
                        systemImage: "exclamationmark.triangle.fill",
                        title: "Unable to load videos",
                        message: error,
                        actionTitle: "Retry",
                        action: { Task { await client.fetchHomeFeed() } }
                    )
                } else if videos.isEmpty {
                    TLEmptyState(
                        systemImage: auth.isSignedIn ? "film" : "person.crop.circle.badge.questionmark",
                        title: auth.isSignedIn ? "No videos yet" : "Sign in for a personalized feed",
                        message: auth.isSignedIn
                            ? "Try reloading, or search for something to watch."
                            : "Use Search anytime, or sign in from the Account tab.",
                        actionTitle: auth.isSignedIn ? "Reload" : nil,
                        action: auth.isSignedIn ? { Task { await client.fetchHomeFeed() } } : nil
                    )
                } else {
                    LazyVGrid(columns: columns, alignment: .center, spacing: TLTheme.gridGap) {
                        ForEach(Array(videos.enumerated()), id: \.element.id) { index, video in
                            VideoCardView(video: video, onSelect: onSelect)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .onAppear {
                                    if index >= videos.count - 4 {
                                        Task { await client.fetchMoreHomeFeed() }
                                    }
                                }
                        }
                    }
                    .padding(.horizontal, TLTheme.pageInset)
                    
                    if client.isLoadingMore {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                }
            }
            .padding(.bottom, 48)
        }
        .background(TLTheme.canvas.ignoresSafeArea())
        .task {
            if client.homeVideos.isEmpty {
                await client.fetchHomeFeed()
            }
        }
    }
    
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            TLBrandMark()
            Spacer()
            Text(auth.isSignedIn ? "For You" : "Explore")
                .font(.callout)
                .foregroundColor(TLTheme.textSecondary)
        }
    }
}

// MARK: - Search

private struct SearchFeedView: View {
    @StateObject private var client = TubeLiteGatewayClient.shared
    let onSelect: (VideoItem) -> Void
    
    @State private var query = ""
    @State private var appliedQuery = ""
    
    private var videos: [VideoItem] {
        client.searchResults.filter { !$0.isShort }
    }
    
    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TLTheme.gridGap, alignment: .top),
            count: TLTheme.gridColumns
        )
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Search")
                .font(.title2.weight(.semibold))
                .foregroundColor(TLTheme.textPrimary)
                .padding(.horizontal, TLTheme.pageInset)
                .padding(.top, 20)
            
            HStack(spacing: 16) {
                TextField("Search YouTube", text: $query)
                    .font(.body)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(TLTheme.surface))
                    .onSubmit(submit)
                
                TLButton("Search", systemImage: "magnifyingglass", action: submit)
            }
            .padding(.horizontal, TLTheme.pageInset)
            
            ScrollView(.vertical, showsIndicators: false) {
                Group {
                    if appliedQuery.isEmpty {
                        TLEmptyState(
                            systemImage: "magnifyingglass",
                            title: "Find something to watch",
                            message: "Search for videos, channels, or topics."
                        )
                    } else if client.isLoading && videos.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)
                    } else if videos.isEmpty {
                        TLEmptyState(
                            systemImage: "video.slash",
                            title: "No videos found",
                            message: "Try different keywords."
                        )
                    } else {
                        LazyVGrid(columns: columns, alignment: .center, spacing: TLTheme.gridGap) {
                            ForEach(Array(videos.enumerated()), id: \.element.id) { index, video in
                                VideoCardView(video: video, onSelect: onSelect)
                                    .frame(maxWidth: .infinity, alignment: .topLeading)
                                    .onAppear {
                                        if index >= videos.count - 4 {
                                            Task { await client.fetchMoreSearchResults() }
                                        }
                                    }
                            }
                        }
                        .padding(.horizontal, TLTheme.pageInset)
                        
                        if client.isLoadingMore {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 24)
                        }
                    }
                }
                .padding(.bottom, 48)
            }
        }
        .background(TLTheme.canvas.ignoresSafeArea())
    }
    
    private func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        appliedQuery = trimmed
        Task { await client.search(query: trimmed) }
    }
}
