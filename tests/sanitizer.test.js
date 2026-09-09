import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidVideo,
  isShortVideo,
  sanitizeContents,
  recursiveSanitize
} from '../cloudflare/sanitizer.js';

describe('Cloudflare Worker Sanitizer - Playlist & Non-Video Filtering', () => {
  it('filters out tileRenderer with TILE_CONTENT_TYPE_PLAYLIST and non-video types', () => {
    // Playlists
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_PLAYLIST', contentId: 'pl123' } }), false);
    assert.equal(isValidVideo({ contentType: 'TILE_CONTENT_TYPE_PLAYLIST', contentId: 'pl123' }), false);
    assert.equal(isValidVideo({ tileRenderer: { contentId: 'PLabcdef123456' } }), false);

    // Channels
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_CHANNEL', contentId: 'UC123' } }), false);
    assert.equal(isValidVideo({ tileRenderer: { contentId: 'UCabcdef123456' } }), false);

    // Radios / Mixes / Posts / Games
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_RADIO' } }), false);
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_MIX' } }), false);
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_POST' } }), false);
    assert.equal(isValidVideo({ tileRenderer: { contentType: 'TILE_CONTENT_TYPE_GAME' } }), false);

    // Valid tileRenderer videos
    assert.equal(isValidVideo({ tileRenderer: { contentId: 'tv_vid_valid', contentType: 'TILE_CONTENT_TYPE_VIDEO' } }), true);
    assert.equal(isValidVideo({ tileRenderer: { contentId: 'tv_vid_valid_no_type' } }), true);
  });

  it('filters out lockupViewModel playlists, albums, and mixes', () => {
    // Standard playlist
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'PL999' } }), false);
    // Radio / Mix playlist (RD prefix)
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'RDlTRiuFIWV54' } }), false);
    // Music Album
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_ALBUM', contentId: 'OLAK5uy_foo' } }), false);
    // Channel
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_CHANNEL', contentId: 'UC999' } }), false);
    // Stacked collection thumbnail
    assert.equal(isValidVideo({
      lockupViewModel: {
        contentId: 'abc12345678',
        contentImage: { collectionThumbnailViewModel: {} }
      }
    }), false);

    // Valid video lockups
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'good_vid_12' } }), true);
    // Music video lockup (valid video ID)
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_MUSIC', contentId: 'lTRiuFIWV54' } }), true);
    // Music mix lockup (RD prefix) -> rejected
    assert.equal(isValidVideo({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_MUSIC', contentId: 'RDlTRiuFIWV54' } }), false);
  });

  it('filters out direct playlistRenderer, compactPlaylistRenderer, and radioRenderer', () => {
    assert.equal(isValidVideo({ playlistRenderer: { playlistId: 'PL123' } }), false);
    assert.equal(isValidVideo({ compactPlaylistRenderer: { playlistId: 'PL456' } }), false);
    assert.equal(isValidVideo({ radioRenderer: { playlistId: 'RD123' } }), false);
    assert.equal(isValidVideo({ compactStationRenderer: {} }), false);
    assert.equal(isValidVideo({ channelRenderer: { channelId: 'UC123' } }), false);
  });

  it('sanitizeContents removes playlists and preserves valid videos and continuation tokens', () => {
    const rawItems = [
      { tileRenderer: { contentId: 'pl_001', contentType: 'TILE_CONTENT_TYPE_PLAYLIST' } },
      { tileRenderer: { contentId: 'vid_001', contentType: 'TILE_CONTENT_TYPE_VIDEO' } },
      { playlistRenderer: { playlistId: 'PL_foo' } },
      { lockupViewModel: { contentId: 'pl_002', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
      { videoRenderer: { videoId: 'vid_002' } },
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'CONT_TOKEN_1' } } } }
    ];

    const { contents, validCount, continuationItem } = sanitizeContents(rawItems);
    assert.equal(validCount, 2);
    assert.equal(contents.length, 3); // 2 videos + 1 continuation
    assert.equal(contents[0].tileRenderer.contentId, 'vid_001');
    assert.equal(contents[1].videoRenderer.videoId, 'vid_002');
    assert.ok(continuationItem);
    assert.equal(continuationItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token, 'CONT_TOKEN_1');
  });

  it('recursiveSanitize cleans nested shelves containing tileRenderer playlists', () => {
    const upstreamResponse = {
      contents: {
        tvBrowseRenderer: {
          content: {
            tvSurfaceContentRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      shelfRenderer: {
                        content: {
                          horizontalListRenderer: {
                            items: [
                              {
                                tileRenderer: {
                                  contentId: 'PL_playlist_to_drop',
                                  contentType: 'TILE_CONTENT_TYPE_PLAYLIST'
                                }
                              },
                              {
                                tileRenderer: {
                                  contentId: 'tv_valid_video',
                                  contentType: 'TILE_CONTENT_TYPE_VIDEO'
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    };

    const { sanitizedObj, validCount } = recursiveSanitize(upstreamResponse);
    assert.equal(validCount, 1);

    const items = sanitizedObj.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].tileRenderer.contentId, 'tv_valid_video');
  });

  it('recursiveSanitize preserves search results with itemSectionRenderer and continuationItemRenderer', () => {
    const searchResponse = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      { playlistRenderer: { playlistId: 'PL_search_playlist' } },
                      { videoRenderer: { videoId: 'search_vid_1' } },
                      { videoRenderer: { videoId: 'search_vid_2' } },
                      { reelShelfRenderer: {} }
                    ]
                  }
                },
                {
                  continuationItemRenderer: {
                    continuationEndpoint: {
                      continuationCommand: {
                        token: 'SEARCH_CONT_TOKEN_999'
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      }
    };

    const { sanitizedObj, validCount, continuationToken } = recursiveSanitize(searchResponse);
    assert.equal(validCount, 2);
    assert.equal(continuationToken, 'SEARCH_CONT_TOKEN_999');

    const sections = sanitizedObj.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
    assert.equal(sections.length, 2);
    assert.ok(sections[0].itemSectionRenderer);
    assert.equal(sections[0].itemSectionRenderer.contents.length, 2);
    assert.equal(sections[0].itemSectionRenderer.contents[0].videoRenderer.videoId, 'search_vid_1');
    assert.equal(sections[0].itemSectionRenderer.contents[1].videoRenderer.videoId, 'search_vid_2');
    assert.ok(sections[1].continuationItemRenderer);
  });

  it('recursiveSanitize preserves search continuation with appendContinuationItemsAction', () => {
    const contResponse = {
      onResponseReceivedCommands: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              {
                itemSectionRenderer: {
                  contents: [
                    { videoRenderer: { videoId: 'cont_vid_1' } },
                    { playlistRenderer: { playlistId: 'PL_bad' } }
                  ]
                }
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: {
                    continuationCommand: {
                      token: 'NEXT_PAGE_TOKEN_ABC'
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    };

    const { sanitizedObj, validCount, continuationToken } = recursiveSanitize(contResponse);
    assert.equal(validCount, 1);
    assert.equal(continuationToken, 'NEXT_PAGE_TOKEN_ABC');

    const items = sanitizedObj.onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems;
    assert.equal(items.length, 2);
    assert.equal(items[0].itemSectionRenderer.contents.length, 1);
    assert.equal(items[0].itemSectionRenderer.contents[0].videoRenderer.videoId, 'cont_vid_1');
  });

  it('filters out episodic series and playlist tileRenderers with browseEndpoint and stacking effect', () => {
    const playlistTile = {
      tileRenderer: {
        style: 'TILE_STYLE_YTLR_DEFAULT',
        header: {
          tileHeaderRenderer: {
            thumbnail: {
              thumbnails: [{ url: 'https://i.ytimg.com/vi/0FH9cgRhQ-k/hqdefault.jpg', width: 320, height: 180 }]
            },
            thumbnailOverlays: [
              {
                thumbnailOverlayTimeStatusRenderer: {
                  text: { runs: [{ text: '12' }, { text: ' episodes' }] },
                  style: 'DEFAULT'
                }
              },
              {
                thumbnailOverlayStackingEffectRenderer: {
                  upperStackColor: 4283319129,
                  lowerStackColor: 4286871187
                }
              }
            ]
          }
        },
        metadata: {
          tileMetadataRenderer: {
            title: { simpleText: 'Black Holes' }
          }
        },
        onSelectCommand: {
          browseEndpoint: {
            browseId: 'VLPLFs4vir_WsTwKi93uWnfp4xdVuu4M-OdN',
            params: 'kgYPKgswRkg5Y2dSaFEta0AB',
            pageAnimation: {
              preloadPageConfig: {
                ghostState: 'GHOST_STATE_EPISODIC_SHOW_PAGE'
              }
            }
          }
        },
        contentId: '0FH9cgRhQ-k',
        contentType: 'TILE_CONTENT_TYPE_VIDEO'
      }
    };

    assert.equal(isValidVideo(playlistTile), false);
    assert.equal(isValidVideo(playlistTile.tileRenderer), false);
  });
});


