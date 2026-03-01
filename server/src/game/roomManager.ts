import { Room } from './room';

export class RoomManager {
  private rooms = new Map<string, Room>();

  getOrCreateRoom(roomId = 'pond-1') {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room = new Room(roomId);
    this.rooms.set(roomId, room);
    return room;
  }

  allRooms() {
    return this.rooms.values();
  }

  removeRoom(roomId: string) {
    this.rooms.delete(roomId);
  }

  deleteEmptyRooms() {
    let removed = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.players.size > 0) continue;
      this.rooms.delete(roomId);
      removed += 1;
    }
    return removed;
  }

  roomCount() {
    return this.rooms.size;
  }

  playerCount() {
    let total = 0;
    for (const room of this.rooms.values()) total += room.players.size;
    return total;
  }
}
