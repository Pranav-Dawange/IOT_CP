"""
WebSocket Connection Manager for Real-Time Live Event Broadcasting (Phase 6).

Broadcasts:
- 'telemetry': Newly persisted valid processed telemetry
- 'prediction': Newly calculated live GRU failure predictions
- 'alert': Edge diagnostic alerts (threshold violations, sequence gaps, etc.)
- 'status': Asset connectivity/lifecycle status updates
- 'summary': Periodic aggregation summaries

Ensures disconnected clients are pruned cleanly without crashing the server.
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, List, Set

from fastapi import WebSocket

logger = logging.getLogger("backend.websocket")


class ConnectionManager:
    """
    Manages active WebSocket connections and thread-safe broadcasts.
    """

    def __init__(self):
        self._active_connections: Set[WebSocket] = set()
        self._lock: Optional[asyncio.Lock] = None

    @property
    def lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register new WebSocket client."""
        await websocket.accept()
        async with self.lock:
            self._active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self._active_connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Unregister disconnected client."""
        async with self.lock:
            self._active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self._active_connections)}")

    @property
    def client_count(self) -> int:
        return len(self._active_connections)

    async def broadcast(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Broadcast structured event to all active clients.
        Cleanly removes any dead sockets.
        """
        if not self._active_connections:
            return

        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        text_data = json.dumps(message)

        dead_connections: List[WebSocket] = []

        async with self.lock:
            for connection in list(self._active_connections):
                try:
                    await connection.send_text(text_data)
                except Exception as e:
                    logger.debug(f"Failed to send message to websocket client: {e}. Marking for removal.")
                    dead_connections.append(connection)

            for dead in dead_connections:
                self._active_connections.discard(dead)


# Global singleton instance
ws_manager = ConnectionManager()
