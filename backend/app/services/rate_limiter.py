import time
from collections import defaultdict, deque


class InMemoryRateLimiter:
    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.time()
        q = self._events[key]
        while q and now - q[0] > self.window_seconds:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(now)
        return True
