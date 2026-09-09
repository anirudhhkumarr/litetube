import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBrowseResponse,
  buildBrowsePayload,
  buildNextPayload,
  buildSearchPayload,
  generateSAPISIDHASH,
  extractSAPISID,
  extractWatchedAnnotation,
  extractRunsText
} from '../src/api/innertube.js';

describe('InnerTube - SAPISIDHASH Auth Generator', () => {
  it('generates valid SAPISIDHASH token using SHA-1', async () => {
    const sapisid = 'test_sapisid_token';
    const origin = 'https://www.youtube.com';
    const timestamp = 1700000000;

    const hash = await generateSAPISIDHASH(sapisid, origin, timestamp);
    assert.ok(hash.startsWith('SAPISIDHASH 1700000000_'));
    // SHA-1 is 40 hex chars
    const hex = hash.split('_')[1];
    assert.equal(hex.length, 40);
  });

  it('extracts SAPISID from raw token or full cookie string', () => {
    assert.equal(extractSAPISID('my_raw_sapisid_token'), 'my_raw_sapisid_token');
    assert.equal(extractSAPISID('SAPISID=token_abc_123; HSID=other'), 'token_abc_123');
    assert.equal(extractSAPISID('PREF=f1=50000000; __Secure-3PAPISID=secure_token_456; SID=xyz'), 'secure_token_456');
    assert.equal(extractSAPISID('VISITOR_INFO1_LIVE=abc; __Secure-1PAPISID=secure1_token_789;'), 'secure1_token_789');
    assert.equal(extractSAPISID(''), '');
    assert.equal(extractSAPISID(null), '');
  });
});

describe('InnerTube - Payload Builder', () => {
  it('constructs well-formed InnerTube browse payload', () => {
    const payload = buildBrowsePayload({ browseId: 'FEwhat_to_watch' });
    assert.equal(payload.browseId, 'FEwhat_to_watch');
    assert.equal(payload.context.client.clientName, 'WEB');
    assert.ok(payload.context.client.clientVersion);
  });

  it('includes continuation token for pagination', () => {
    const payload = buildBrowsePayload({ continuationToken: 'TOKEN_XYZ_123' });
    assert.equal(payload.continuation, 'TOKEN_XYZ_123');
  });

  it('constructs well-formed InnerTube next (watch) payload', () => {
    const payload = buildNextPayload({ videoId: 'watch_vid_789' });
    assert.equal(payload.videoId, 'watch_vid_789');
    assert.equal(payload.context.client.clientName, 'WEB');
  });

  it('constructs well-formed InnerTube search payload', () => {
    const payload = buildSearchPayload({ query: 'space exploration' });
    assert.equal(payload.query, 'space exploration');
    assert.equal(payload.context.client.clientName, 'WEB');
  });
});

describe('InnerTube - Browse Response Parser', () => {
  const sampleBrowseResponse = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    {
                      richItemRenderer: {
                        content: {
                          videoRenderer: {
                            videoId: 'abc111',
                            title: { runs: [{ text: 'How Quantum Computers Work' }] },
                            ownerText: {
                              runs: [{
                                text: 'Veritasium',
                                navigationEndpoint: { browseEndpoint: { browseId: 'UC_veritasium' } }
                              }]
                            },
                            lengthText: { simpleText: '18:42' },
                            viewCountText: { simpleText: '2.4M views' },
                            publishedTimeText: { simpleText: '3 days ago' },
                            thumbnail: {
                              thumbnails: [
                                { url: 'https://i.ytimg.com/vi/abc111/hqdefault.jpg', width: 320, height: 180 }
                              ]
                            }
                          }
                        }
                      }
                    },
                    {
                      richSectionRenderer: {
                        content: {
                          richShelfRenderer: {
                            title: { runs: [{ text: 'Shorts' }] },
                            contents: [
                              {
                                richItemRenderer: {
                                  content: {
                                    reelItemRenderer: {
                                      videoId: 'short999',
                                      headline: { simpleText: 'Quick trick #shorts' }
                                    }
                                  }
                                }
                              }
                            ]
                          }
                        }
                      }
                    },
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: {
                            token: 'NEXT_PAGE_TOKEN_777'
                          }
                        }
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
  };

  it('correctly parses video metadata and tags shorts shelves', () => {
    const parsed = parseBrowseResponse(sampleBrowseResponse);
    assert.equal(parsed.videos.length, 2); // 1 normal video + 1 reel from shelf
    assert.equal(parsed.continuationToken, 'NEXT_PAGE_TOKEN_777');

    const video = parsed.videos[0];
    assert.equal(video.id, 'abc111');
    assert.equal(video.title, 'How Quantum Computers Work');
    assert.equal(video.channelTitle, 'Veritasium');
    assert.equal(video.channelId, 'UC_veritasium');
    assert.equal(video.duration, '18:42');
    assert.equal(video.durationSeconds, 1122);
    assert.equal(video.views, '2.4M views');
    assert.equal(video.isShort, false);

    const short = parsed.videos[1];
    assert.equal(short.id, 'short999');
    assert.equal(short.isShort, true);
  });

  it('correctly parses search response items', () => {
    const searchResponse = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'search_vid_456',
                          title: { runs: [{ text: 'Deep Learning Specialization' }] },
                          ownerText: { runs: [{ text: 'Andrew Ng' }] },
                          lengthText: { simpleText: '1:12:30' },
                          viewCountText: { simpleText: '800K views' }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };

    const parsed = parseBrowseResponse(searchResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'search_vid_456');
    assert.equal(parsed.videos[0].title, 'Deep Learning Specialization');
    assert.equal(parsed.videos[0].channelTitle, 'Andrew Ng');
    assert.equal(parsed.videos[0].durationSeconds, 4350);
  });
});

describe('InnerTube Client - Dual-Path Routing', () => {
  it('guest (no token) routes through the Cloudflare Worker proxy', async () => {
    const { callInnerTube } = await import('../src/api/innertube.js');

    let interceptedUrl = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, _options) => {
      interceptedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ responseContext: { visitorData: 'test' } })
      };
    };

    try {
      await callInnerTube('browse', {
        context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00' } },
        browseId: 'FEwhat_to_watch'
      }, { workerUrl: 'https://test-worker.internal' });

      assert.equal(interceptedUrl, 'https://test-worker.internal/api/innertube/browse');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('authenticated (Bearer token) routes to Cloudflare Worker with TVHTML5 headers', async () => {
    const { callInnerTube, buildBrowsePayload } = await import('../src/api/innertube.js');

    let interceptedUrl = null;
    let interceptedHeaders = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      interceptedUrl = url;
      interceptedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          responseContext: { visitorData: 'test' }
        })
      };
    };

    try {
      const payload = buildBrowsePayload({ clientType: 'TVHTML5', browseId: 'FEwhat_to_watch' });
      await callInnerTube('browse', payload, {
        workerUrl: 'https://test-worker.internal',
        accessToken: 'ya29.authentic_tv_token'
      });

      assert.equal(interceptedUrl, 'https://test-worker.internal/api/innertube/browse');
      assert.equal(interceptedHeaders['X-YouTube-Client-Name'], 'TVHTML5');
      assert.equal(interceptedHeaders['X-YouTube-Client-Version'], '7.20240901.00.00');
      assert.equal(interceptedHeaders['Authorization'], 'Bearer ya29.authentic_tv_token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('InnerTube - TVHTML5 Browse Parser', () => {
  it('parses TVHTML5 tvBrowseRenderer and tileRenderer structures', () => {
    const tvResponse = {
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
                                  contentId: 'tv_vid_001',
                                  metadata: {
                                    tileMetadataRenderer: {
                                      title: { runs: [{ text: 'Authentic YouTube TV Home' }] },
                                      lines: [
                                        {
                                          lineRenderer: {
                                            items: [
                                              { lineItemRenderer: { text: { runs: [{ text: 'MKBHD' }] } } }
                                            ]
                                          }
                                        },
                                        {
                                          lineRenderer: {
                                            items: [
                                              { lineItemRenderer: { text: { runs: [{ text: '1.2M views' }] } } },
                                              { lineItemRenderer: { text: { runs: [{ text: '2 hours ago' }] } } }
                                            ]
                                          }
                                        }
                                      ]
                                    }
                                  },
                                  header: {
                                    tileHeaderRenderer: {
                                      thumbnailOverlays: [
                                        {
                                          thumbnailOverlayTimeStatusRenderer: {
                                            text: { simpleText: '14:20' }
                                          }
                                        }
                                      ],
                                      thumbnail: {
                                        thumbnails: [{ url: 'https://i.ytimg.com/vi/tv_vid_001/hqdefault.jpg' }]
                                      }
                                    }
                                  }
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

    const parsed = parseBrowseResponse(tvResponse);
    assert.equal(parsed.videos.length, 1);
    const video = parsed.videos[0];
    assert.equal(video.id, 'tv_vid_001');
    assert.equal(video.title, 'Authentic YouTube TV Home');
    assert.equal(video.channelTitle, 'MKBHD');
    assert.equal(video.views, '1.2M views');
    assert.equal(video.publishedTime, '2 hours ago');
    assert.equal(video.duration, '14:20');
    assert.equal(video.durationSeconds, 860);
    assert.equal(video.type, 'tileRenderer');
  });
});

describe('InnerTube - Watch Next & Lockup Parser', () => {
  it('parses twoColumnWatchNextResults secondary results with lockupViewModel', () => {
    const watchNextResponse = {
      contents: {
        twoColumnWatchNextResults: {
          secondaryResults: {
            secondaryResults: {
              results: [
                {
                  lockupViewModel: {
                    contentId: 'related_vid_123',
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: { content: 'Understanding Neural Networks' },
                        metadata: {
                          contentMetadataViewModel: {
                            metadataRows: [
                              {
                                metadataParts: [
                                  { text: { content: 'Grant Sanderson' } }
                                ]
                              },
                              {
                                metadataParts: [
                                  { text: { content: '4.8M' }, accessibilityLabel: '4.8 million views' },
                                  { text: { content: '3 years ago' } }
                                ]
                              }
                            ]
                          }
                        }
                      }
                    },
                    contentImage: {
                      thumbnailViewModel: {
                        image: {
                          sources: [{ url: 'https://i.ytimg.com/vi/related_vid_123/hqdefault.jpg' }]
                        },
                        overlays: [
                          {
                            thumbnailBottomOverlayViewModel: {
                              badges: [
                                {
                                  thumbnailBadgeViewModel: {
                                    text: '19:13'
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                },
                {
                  continuationItemRenderer: {
                    continuationEndpoint: {
                      continuationCommand: {
                        token: 'NEXT_RELATED_CONTINUATION_TOKEN'
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

    const parsed = parseBrowseResponse(watchNextResponse);
    assert.equal(parsed.videos.length, 1);
    const v = parsed.videos[0];
    assert.equal(v.id, 'related_vid_123');
    assert.equal(v.title, 'Understanding Neural Networks');
    assert.equal(v.channelTitle, 'Grant Sanderson');
    assert.equal(v.views, '4.8 million views');
    assert.equal(v.viewCount, 4800000);
    assert.equal(v.duration, '19:13');
    assert.equal(v.durationSeconds, 1153);
    assert.equal(v.isShort, false);
    assert.equal(v.type, 'lockupViewModel');
    assert.equal(parsed.continuationToken, 'NEXT_RELATED_CONTINUATION_TOKEN');
  });

  it('correctly tags shortsLockupViewModel as shorts', () => {
    const shortsResponse = {
      contents: {
        richGridRenderer: {
          contents: [
            {
              richItemRenderer: {
                content: {
                  shortsLockupViewModel: {
                    contentId: 'short_vid_999',
                    contentType: 'LOCKUP_CONTENT_TYPE_SHORTS',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: { content: 'Quick Chemistry Trick #shorts' }
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      }
    };

    const parsed = parseBrowseResponse(shortsResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'short_vid_999');
    assert.equal(parsed.videos[0].isShort, true);
  });

  it('correctly identifies watched annotations from thumbnail overlays and badges', () => {
    // 1. Resume playback renderer
    const ovResume = [
      {
        thumbnailOverlayResumePlaybackRenderer: {
          percentDurationWatched: 88
        }
      }
    ];
    const res1 = extractWatchedAnnotation({}, ovResume);
    assert.equal(res1.isWatched, true);
    assert.equal(res1.percentWatched, 88);

    // 2. Playback status renderer with WATCHED text
    const ovStatus = [
      {
        thumbnailOverlayPlaybackStatusRenderer: {
          texts: [{ runs: [{ text: 'WATCHED' }] }]
        }
      }
    ];
    const res2 = extractWatchedAnnotation({}, ovStatus);
    assert.equal(res2.isWatched, true);

    // 3. Time status renderer with WATCHED style
    const ovStyle = [
      {
        thumbnailOverlayTimeStatusRenderer: {
          style: 'WATCHED',
          text: { simpleText: 'WATCHED' }
        }
      }
    ];
    const res3 = extractWatchedAnnotation({}, ovStyle);
    assert.equal(res3.isWatched, true);

    // 4. Metadata badge with label WATCHED
    const rendererBadge = {
      badges: [
        {
          metadataBadgeRenderer: {
            label: 'WATCHED'
          }
        }
      ]
    };
    const res4 = extractWatchedAnnotation(rendererBadge, []);
    assert.equal(res4.isWatched, true);

    // 5. Unwatched video with small progress (15%)
    const ovUnwatched = [
      {
        thumbnailOverlayResumePlaybackRenderer: {
          percentDurationWatched: 15
        }
      }
    ];
    const res5 = extractWatchedAnnotation({}, ovUnwatched);
    assert.equal(res5.isWatched, false);
    assert.equal(res5.percentWatched, 15);
  });

  it('correctly parses inverted metadataRows where views/date precede channel name', () => {
    const invertedResponse = {
      contents: {
        twoColumnWatchNextResults: {
          secondaryResults: {
            secondaryResults: {
              results: [
                {
                  lockupViewModel: {
                    contentId: 'cq36YXrfyJE',
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: { content: 'Ads You See Online Are Now Police Surveillance' },
                        metadata: {
                          contentMetadataViewModel: {
                            metadataRows: [
                              // Row 0 has metrics/timestamp first (inverted order)
                              {
                                metadataParts: [
                                  { text: { content: '306K views' } },
                                  { text: { content: '8 hours ago' } }
                                ]
                              },
                              // Row 1 has the channel with browseEndpoint
                              {
                                metadataParts: [
                                  {
                                    text: { content: 'The Infographics Show' },
                                    commandContext: {
                                      onTap: {
                                        innertubeCommand: {
                                          browseEndpoint: { browseId: 'UC_infographics' }
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            ]
                          }
                        }
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

    const parsed = parseBrowseResponse(invertedResponse);
    assert.equal(parsed.videos.length, 1);
    const v = parsed.videos[0];
    assert.equal(v.id, 'cq36YXrfyJE');
    assert.equal(v.title, 'Ads You See Online Are Now Police Surveillance');
    assert.equal(v.channelTitle, 'The Infographics Show');
    assert.equal(v.channelId, 'UC_infographics');
    assert.equal(v.views, '306K views');
    assert.equal(v.publishedTime, '8 hours ago');
  });

  it('correctly parses multi-run titles and resolves channel semantically without hardcoded hacks', () => {
    // Multi-run title scenario (like YmaSEZ6ju2I)
    const multiRunResponse = {
      contents: {
        twoColumnWatchNextResults: {
          secondaryResults: {
            secondaryResults: {
              results: [
                {
                  lockupViewModel: {
                    contentId: 'YmaSEZ6ju2I',
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: {
                          runs: [
                            { text: 'This Revelation Could ' },
                            { text: "Detail Benjamin Netanyahu's " },
                            { text: 'Re-Election Bid...' }
                          ]
                        },
                        metadata: {
                          contentMetadataViewModel: {
                            metadataRows: [
                              {
                                metadataParts: [
                                  {
                                    text: { content: 'India Global Review' },
                                    commandContext: {
                                      onTap: {
                                        innertubeCommand: {
                                          browseEndpoint: { browseId: 'UC_indiaglobal' }
                                        }
                                      }
                                    }
                                  }
                                ]
                              },
                              {
                                metadataParts: [
                                  { text: { content: '45K views' } },
                                  { text: { content: '1 day ago' } }
                                ]
                              }
                            ]
                          }
                        }
                      }
                    }
                  }
                },
                // Video with inverted rows (like wJo1PV9ErM4)
                {
                  lockupViewModel: {
                    contentId: 'wJo1PV9ErM4',
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: { content: 'OpenAI is Completely F*cked.' },
                        metadata: {
                          contentMetadataViewModel: {
                            metadataRows: [
                              {
                                metadataParts: [
                                  { text: { content: '1.1M views' } },
                                  { text: { content: '2 days ago' } }
                                ]
                              },
                              {
                                metadataParts: [
                                  {
                                    text: { content: 'Moon' },
                                    commandContext: {
                                      onTap: {
                                        innertubeCommand: {
                                          browseEndpoint: { browseId: 'UC_moon' }
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            ]
                          }
                        }
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

    const parsed = parseBrowseResponse(multiRunResponse);
    assert.equal(parsed.videos.length, 2);

    const v1 = parsed.videos[0];
    assert.equal(v1.id, 'YmaSEZ6ju2I');
    assert.equal(v1.title, "This Revelation Could Detail Benjamin Netanyahu's Re-Election Bid...");
    assert.equal(v1.channelTitle, 'India Global Review');
    assert.equal(v1.channelId, 'UC_indiaglobal');

    const v2 = parsed.videos[1];
    assert.equal(v2.id, 'wJo1PV9ErM4');
    assert.equal(v2.title, 'OpenAI is Completely F*cked.');
    assert.equal(v2.channelTitle, 'Moon');
    assert.equal(v2.channelId, 'UC_moon');
  });

  it('filters out non-video lockups like channels, playlists, and mixes', () => {
    const mixedResponse = {
      contents: {
        twoColumnWatchNextResults: {
          secondaryResults: {
            secondaryResults: {
              results: [
                {
                  lockupViewModel: {
                    contentId: 'UC_channel_123',
                    contentType: 'LOCKUP_CONTENT_TYPE_CHANNEL',
                    metadata: { lockupMetadataViewModel: { title: { content: 'A Channel' } } }
                  }
                },
                {
                  lockupViewModel: {
                    contentId: 'PL_playlist_456',
                    contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                    metadata: { lockupMetadataViewModel: { title: { content: 'A Playlist' } } }
                  }
                },
                {
                  lockupViewModel: {
                    contentId: 'valid_video_789',
                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                    metadata: {
                      lockupMetadataViewModel: {
                        title: { content: 'A Valid Video' },
                        metadata: {
                          contentMetadataViewModel: {
                            metadataRows: [
                              { metadataParts: [{ text: { content: 'Creator' } }] }
                            ]
                          }
                        }
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

    const parsed = parseBrowseResponse(mixedResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'valid_video_789');
  });
});

describe('InnerTube - extractRunsText helper', () => {
  it('handles string, simpleText, content, and runs array correctly', () => {
    assert.equal(extractRunsText('direct string'), 'direct string');
    assert.equal(extractRunsText({ content: 'content text' }), 'content text');
    assert.equal(extractRunsText({ simpleText: 'simple text' }), 'simple text');
    assert.equal(extractRunsText({ runs: [{ text: 'Hello ' }, { text: 'World' }] }), 'Hello World');
    assert.equal(extractRunsText({ runs: [{ text: 'Only ' }, null, { other: 'ignored' }, { text: 'Valid' }] }), 'Only Valid');
    assert.equal(extractRunsText(null), '');
    assert.equal(extractRunsText(undefined), '');
  });
});

