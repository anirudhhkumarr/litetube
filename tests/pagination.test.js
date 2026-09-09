import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBrowseResponse,
  buildBrowsePayload
} from '../src/api/innertube.js';

describe('Pagination & Continuation Tests', () => {
  it('extracts continuationToken from search sectionListRenderer contents', () => {
    const searchResponseWithContinuation = {
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
                          videoId: 'vid_page1_1',
                          title: { runs: [{ text: 'Page 1 Video' }] },
                          ownerText: { runs: [{ text: 'TechChannel' }] },
                          lengthText: { simpleText: '10:00' }
                        }
                      }
                    ]
                  }
                },
                {
                  continuationItemRenderer: {
                    continuationEndpoint: {
                      continuationCommand: {
                        token: 'SEARCH_CONTINUATION_TOKEN_PAGE_2'
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

    const parsed = parseBrowseResponse(searchResponseWithContinuation);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'vid_page1_1');
    assert.equal(parsed.continuationToken, 'SEARCH_CONTINUATION_TOKEN_PAGE_2');
  });

  it('parses continuation response from onResponseReceivedActions and extracts next token', () => {
    const continuationActionResponse = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              {
                richItemRenderer: {
                  content: {
                    videoRenderer: {
                      videoId: 'vid_page2_1',
                      title: { runs: [{ text: 'Page 2 Video' }] },
                      ownerText: { runs: [{ text: 'ScienceChannel' }] },
                      lengthText: { simpleText: '15:20' }
                    }
                  }
                }
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: {
                    continuationCommand: {
                      token: 'SEARCH_CONTINUATION_TOKEN_PAGE_3'
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    };

    const parsed = parseBrowseResponse(continuationActionResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'vid_page2_1');
    assert.equal(parsed.continuationToken, 'SEARCH_CONTINUATION_TOKEN_PAGE_3');
  });

  it('parses search continuation action containing itemSectionRenderer', () => {
    const searchContinuationActionResponse = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'vid_search_page2',
                        title: { runs: [{ text: 'Search Page 2 Video' }] },
                        ownerText: { runs: [{ text: 'MathChannel' }] },
                        lengthText: { simpleText: '22:15' }
                      }
                    }
                  ]
                }
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: {
                    continuationCommand: {
                      token: 'SEARCH_CONTINUATION_TOKEN_PAGE_4'
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    };

    const parsed = parseBrowseResponse(searchContinuationActionResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'vid_search_page2');
    assert.equal(parsed.continuationToken, 'SEARCH_CONTINUATION_TOKEN_PAGE_4');
  });

  it('parses continuation from onResponseReceivedCommands with videoWithContextRenderer', () => {
    const commandsResponse = {
      onResponseReceivedCommands: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoWithContextRenderer: {
                        videoId: 'vid_mweb_page2',
                        headline: { runs: [{ text: 'MWEB Continuation Video' }] },
                        shortBylineText: { runs: [{ text: 'Mobile Creator' }] },
                        lengthText: { simpleText: '14:20' }
                      }
                    }
                  ]
                }
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: {
                    continuationCommand: {
                      token: 'MWEB_NEXT_TOKEN_PAGE_3'
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    };

    const parsed = parseBrowseResponse(commandsResponse);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'vid_mweb_page2');
    assert.equal(parsed.videos[0].title, 'MWEB Continuation Video');
    assert.equal(parsed.videos[0].channelTitle, 'Mobile Creator');
    assert.equal(parsed.continuationToken, 'MWEB_NEXT_TOKEN_PAGE_3');
  });

  it('correctly constructs continuation payload for InnerTube', () => {
    const payload = buildBrowsePayload({ continuationToken: 'TOKEN_NEXT' });
    assert.equal(payload.continuation, 'TOKEN_NEXT');
    assert.equal(payload.context.client.clientName, 'WEB');
    assert.equal(payload.browseId, undefined);
  });

  it('parses watch next continuation from onResponseReceivedEndpoints', () => {
    const watchNextContinuation = {
      onResponseReceivedEndpoints: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              {
                lockupViewModel: {
                  contentId: 'related_cont_vid_01',
                  metadata: {
                    lockupMetadataViewModel: {
                      title: { content: 'Related Video Part 2' },
                      metadata: {
                        contentMetadataViewModel: {
                          metadataRows: [
                            { metadataParts: [{ text: { content: 'Math Channel' } }] },
                            { metadataParts: [{ text: { content: '1.5M views' } }] }
                          ]
                        }
                      }
                    }
                  }
                }
              },
              {
                continuationItemRenderer: {
                  continuationEndpoint: {
                    continuationCommand: {
                      token: 'WATCH_NEXT_PAGE_3_TOKEN'
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    };

    const parsed = parseBrowseResponse(watchNextContinuation);
    assert.equal(parsed.videos.length, 1);
    assert.equal(parsed.videos[0].id, 'related_cont_vid_01');
    assert.equal(parsed.videos[0].title, 'Related Video Part 2');
    assert.equal(parsed.continuationToken, 'WATCH_NEXT_PAGE_3_TOKEN');
  });
});
