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
}
