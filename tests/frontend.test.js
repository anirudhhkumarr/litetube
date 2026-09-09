import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import esbuild from 'esbuild';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Mock minimal browser globals for SSR / node execution
globalThis.window = {
  location: { search: '' },
  localStorage: {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, val) { this._data[key] = String(val); },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; }
  },
  addEventListener: () => {},
  removeEventListener: () => {}
};
globalThis.localStorage = globalThis.window.localStorage;

// Helper to compile a JSX file to CommonJS and import it
async function loadComponent(filePath) {
  const cacheDir = path.resolve('node_modules/.cache/litetube-tests');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const tempOut = path.join(cacheDir, `${path.basename(filePath, path.extname(filePath))}.cjs`);
  await esbuild.build({
    entryPoints: [filePath],
    bundle: true,
    format: 'cjs',
    outfile: tempOut,
    external: ['react', 'react-dom', 'react-dom/server'],
    loader: { '.jsx': 'jsx', '.js': 'js', '.css': 'empty' }
  });

  const req = createRequire(import.meta.url);
  const mod = req(tempOut);
  try {
    fs.unlinkSync(tempOut);
  } catch {}
  return mod.default || mod;
}

describe('Frontend Component Tests', () => {
  it('App renders without throwing ReferenceError or runtime errors', async () => {
    const App = await loadComponent('src/App.jsx');
    assert.strictEqual(typeof App, 'function', 'App must be a React component function');

    const html = renderToString(React.createElement(App));
    assert.ok(html.length > 0, 'App must render non-empty HTML');
    assert.ok(html.includes('navbar'), 'App must render navbar component');
    assert.ok(html.includes('search-input'), 'App must render search input');
  });

  it('App hydrates watch page directly when ?v= is present in URL', async () => {
    const originalSearch = globalThis.window.location.search;
    try {
      globalThis.window.location.search = '?v=direct_video_456';
      const App = await loadComponent('src/App.jsx');
      const html = renderToString(React.createElement(App));

      assert.ok(html.includes('direct_video_456'), 'App must mount player for ?v= query');
      assert.ok(html.includes('embed/direct_video_456'), 'App must include embed url for ?v= query');
    } finally {
      globalThis.window.location.search = originalSearch;
    }
  });

  it('App hydrates search page directly when ?q= is present in URL', async () => {
    const originalSearch = globalThis.window.location.search;
    try {
      globalThis.window.location.search = '?q=technology';
      const App = await loadComponent('src/App.jsx');
      const html = renderToString(React.createElement(App));

      assert.ok(html.includes('technology'), 'App must hydrate search query in navbar or search banner');
    } finally {
      globalThis.window.location.search = originalSearch;
    }
  });

  it('Navbar renders brand and control buttons', async () => {
    const Navbar = await loadComponent('src/components/Navbar.jsx');
    const html = renderToString(
      React.createElement(Navbar, {
        searchQuery: '',
        onSearchChange: () => {},
        onSearchSubmit: () => {},
        focusMode: true,
        onToggleFocus: () => {},
        onOpenAccount: () => {},
        user: null
      })
    );

    assert.ok(html.includes('TubeLite'), 'Navbar must render brand text');
    assert.ok(html.includes('Search'), 'Navbar must have Search placeholder or input');
  });

  it('Navbar connects Enter keydown to handleSubmit and onSearchSubmit', async () => {
    const src = fs.readFileSync('src/components/Navbar.jsx', 'utf-8');
    assert.match(src, /if\s*\(\s*e\.key\s*===\s*['"]Enter['"]\s*\)\s*\{[\s\S]*?handleSubmit\s*\(\s*e\s*\)/, 'Enter keydown must trigger handleSubmit');

    const Navbar = await loadComponent('src/components/Navbar.jsx');
    const html = renderToString(
      React.createElement(Navbar, {
        searchQuery: 'testing enter',
        onSearchChange: () => {},
        onSearchSubmit: () => {}
      })
    );
    assert.ok(html.includes('testing enter'), 'Navbar renders the search input with query');
  });

  it('VideoCard renders video title, channel name, and duration', async () => {
    const VideoCard = await loadComponent('src/components/VideoCard.jsx');
    const mockVideo = {
      id: 'abc123xyz',
      title: 'Deep Work Masterclass',
      channelTitle: 'Cal Newport',
      channelId: 'UC_cal_newport',
      thumbnail: 'https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg',
      duration: '45:10',
      views: '120K views',
      publishedTime: '2 days ago'
    };

    const html = renderToString(
      React.createElement(VideoCard, {
        video: mockVideo,
        onSelect: () => {}
      })
    );

    assert.ok(html.includes('Deep Work Masterclass'), 'Card must render title');
    assert.ok(html.includes('Cal Newport'), 'Card must render channel name');
    assert.ok(html.includes('45:10'), 'Card must render duration');
    assert.ok(html.includes('video-card'), 'Card must have video-card class');
  });

  it('VideoGrid renders videos or empty message', async () => {
    const VideoGrid = await loadComponent('src/components/VideoGrid.jsx');
    const mockVideos = [
      {
        id: 'vid1',
        title: 'Video One',
        channelTitle: 'Creator One',
        channelId: 'UC1',
        thumbnail: '',
        duration: '12:30',
        views: '10K views',
        publishedTime: '1 day ago'
      }
    ];

    const htmlWithVideos = renderToString(
      React.createElement(VideoGrid, {
        videos: mockVideos,
        loading: false,
        onSelectVideo: () => {}
      })
    );
    assert.ok(htmlWithVideos.includes('Video One'), 'Grid must render video cards');

    const htmlLoading = renderToString(
      React.createElement(VideoGrid, {
        videos: [],
        loading: true,
        onSelectVideo: () => {}
      })
    );
    assert.ok(htmlLoading.includes('skeleton'), 'Grid must render skeleton cards when loading');

    const htmlLoadingWithOldVideos = renderToString(
      React.createElement(VideoGrid, {
        videos: mockVideos,
        loading: true,
        onSelectVideo: () => {}
      })
    );
    assert.ok(htmlLoadingWithOldVideos.includes('skeleton'), 'Grid must render skeleton cards immediately when loading even if previous videos exist');
    assert.ok(!htmlLoadingWithOldVideos.includes('Video One'), 'Grid must not render old videos while loading new search results');
  });

  it('Navbar renders spinner when loading search results', async () => {
    const Navbar = await loadComponent('src/components/Navbar.jsx');
    const html = renderToString(
      React.createElement(Navbar, {
        searchQuery: 'veritasium',
        onSearchChange: () => {},
        onSearchSubmit: () => {},
        loading: true
      })
    );
    assert.ok(html.includes('search-btn-spinner'), 'Navbar must show search-btn-spinner when loading is true');
  });

  it('PlayerModal renders iframe player without error', async () => {
    const PlayerModal = await loadComponent('src/components/PlayerModal.jsx');
    const mockVideo = {
      id: 'play123',
      title: 'Playing Video',
      channelTitle: 'Channel Stream',
      channelId: 'UC_stream',
      views: '500K views',
      publishedTime: '3 days ago'
    };

    const html = renderToString(
      React.createElement(PlayerModal, {
        video: mockVideo,
        onClose: () => {}
      })
    );

    assert.ok(html.includes('play123'), 'PlayerModal must embed video id');
    assert.ok(html.includes('embed/play123'), 'PlayerModal must embed youtube URL');
  });

  it('AccountModal renders sign-in details', async () => {
    const AccountModal = await loadComponent('src/components/AccountModal.jsx');
    const html = renderToString(
      React.createElement(AccountModal, {
        isOpen: true,
        onClose: () => {},
        currentSession: null,
        onSaveSession: () => {},
        onClearSession: () => {}
      })
    );

    assert.ok(html.includes('YouTube') || html.includes('Account'), 'Account modal must render header');
    assert.ok(html.includes('Connect YouTube Account') || html.includes('Sign In with YouTube'), 'Account modal must render sign-in button');
  });


  it('VideoGrid displays Load More button when hasMore is true, allowing instant load of prefetched items', async () => {
    const VideoGrid = await loadComponent('src/components/VideoGrid.jsx');
    const mockVideos = [
      { id: 'vid1', title: 'Video 1', channelTitle: 'Chan 1', thumbnail: '', duration: '10:00' },
      { id: 'vid2', title: 'Video 2', channelTitle: 'Chan 2', thumbnail: '', duration: '12:00' }
    ];

    const html = renderToString(
      React.createElement(VideoGrid, {
        videos: mockVideos,
        hasMore: true,
        onLoadMore: () => {},
        isLoadingMore: false
      })
    );

    assert.ok(html.includes('Load More Videos'), 'VideoGrid must render Load More Videos button');
    assert.ok(!html.includes('btn-spinner'), 'Load More button should not spin when prefetched videos are available');
  });
});

describe('Production Build Smoke Test', () => {
  it('vite build executes successfully and produces dist bundle without unbound references', () => {
    const output = execSync('npm run build', { encoding: 'utf-8' });
    assert.ok(output.includes('built in'), 'Vite build must complete successfully');
    assert.ok(fs.existsSync('dist/index.html'), 'dist/index.html must exist');

    // Verify generated JS bundle does not contain unbound useState/useEffect calls outside react imports
    const distAssets = fs.readdirSync('dist/assets');
    const jsFiles = distAssets.filter(f => f.endsWith('.js') && !f.endsWith('.map'));
    assert.ok(jsFiles.length > 0, 'Must produce at least one JS bundle');

    for (const jsFile of jsFiles) {
      const bundleCode = fs.readFileSync(path.join('dist/assets', jsFile), 'utf-8');
      // If useState was missing from import, esbuild/Rollup leaves bare 'useState(' without object prefix
      assert.doesNotMatch(bundleCode, /(?<![.\w])useState\s*\(/, 'Bundle must not have unbound bare useState calls');
    }
  });
});
