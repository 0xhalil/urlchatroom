from collections import defaultdict

from fastapi import WebSocket


class WebSocketHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, thread_key: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[thread_key].add(websocket)

    def disconnect(self, thread_key: str, websocket: WebSocket) -> None:
        if thread_key not in self._connections:
            return
        self._connections[thread_key].discard(websocket)
        if not self._connections[thread_key]:
            del self._connections[thread_key]

    async def broadcast(self, thread_key: str, payload: dict) -> None:
        recipients = list(self._connections.get(thread_key, set()))
        for ws in recipients:
            await ws.send_json(payload)
