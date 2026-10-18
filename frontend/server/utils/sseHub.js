const channels = new Map(); // channel -> Map<userId, Set<res>>

function getUserClients(channel, userId = null) {
  if (!channels.has(channel)) {
    channels.set(channel, new Map());
  }
  const userMap = channels.get(channel);
  const key = String(userId || 'all');
  if (!userMap.has(key)) {
    userMap.set(key, new Set());
  }
  return userMap.get(key);
}

export function subscribeStream(channel, res, req = null, userId = null) {
  const clients = getUserClients(channel, userId);
  clients.add(res);

  // Send periodic SSE comment heartbeat to keep idle connections alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 25000);

  let cleanedUp = false;
  const unsubscribe = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    clients.delete(res);
  };

  res.on('close', unsubscribe);
  if (req) {
    req.on('close', unsubscribe);
  }

  return unsubscribe;
}

export function emitStreamEvent(channel, payload, targetUserId = null) {
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  if (!channels.has(channel)) return;
  const userMap = channels.get(channel);

  if (targetUserId !== null && targetUserId !== undefined) {
    const key = String(targetUserId);
    const clients = userMap.get(key);
    if (clients) {
      for (const client of clients) {
        try {
          client.write(body);
        } catch {}
      }
    }
    const allClients = userMap.get('all');
    if (allClients) {
      for (const client of allClients) {
        try {
          client.write(body);
        } catch {}
      }
    }
  } else {
    for (const clients of userMap.values()) {
      for (const client of clients) {
        try {
          client.write(body);
        } catch {}
      }
    }
  }
}

export function subscribeScannerStream(res, req = null, userId = null) {
  return subscribeStream("scan", res, req, userId);
}

export function emitScannerEvent(payload, targetUserId = null) {
  emitStreamEvent("scan", payload, targetUserId);
}
