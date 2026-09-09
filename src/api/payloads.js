export function buildBrowsePayload({ browseId = 'FEwhat_to_watch', continuationToken = null, region = 'US', clientType = 'WEB' } = {}) {
  const isTv = clientType === 'TVHTML5';
  const clientName = isTv ? 'TVHTML5' : 'WEB';
  const clientVersion = isTv ? '7.20240901.00.00' : '2.20240901.00.00';

  const payload = {
    context: {
      client: {
        clientName,
        clientVersion,
        hl: 'en',
        gl: region,
        utcOffsetMinutes: 0
      }
    }
  };

  if (continuationToken) {
    payload.continuation = continuationToken;
  } else if (browseId) {
    payload.browseId = browseId;
  }

  return payload;
}

export function buildPlayerPayload({ videoId, region = 'US' } = {}) {
  return {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.29.35',
        hl: 'en',
        gl: region
      }
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
        signatureTimestamp: 19800
      }
    }
  };
}

export function buildNextPayload({ videoId, continuationToken = null, region = 'US' } = {}) {
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240901.00.00',
        hl: 'en',
        gl: region
      }
    }
  };

  if (continuationToken) {
    payload.continuation = continuationToken;
  } else if (videoId) {
    payload.videoId = videoId;
  }

  return payload;
}

export function buildSearchPayload({ query = '', continuationToken = null, region = 'US', params = 'EgIQAQ==' } = {}) {
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240901.00.00',
        hl: 'en',
        gl: region
      }
    }
  };

  if (continuationToken) {
    payload.continuation = continuationToken;
  } else if (query) {
    payload.query = query;
    if (params) {
      payload.params = params;
    }
  }

  return payload;
}

