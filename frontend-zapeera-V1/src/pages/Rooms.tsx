import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Loader2,
  RefreshCw,
  BedDouble,
  Sparkles,
  Wrench,
  Pencil,
  Ban,
  Settings2,
} from "lucide-react";
import {
  apiService,
  type RoomRecord,
  type RoomStatus,
  type RoomTypeRecord,
} from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Rooms + room types (Wave C5 — Hotel pack). The grid is the
// housekeeping board: each room carries its state (AVAILABLE /
// OCCUPIED / DIRTY / MAINTENANCE) as a color chip. OCCUPIED is owned
// by check-in/check-out — from here housekeeping can only clean a
// dirty room, or take a room in/out of maintenance; the server
// enforces the same machine. Room types (with the nightly rates
// check-in snapshots) are managed in their own dialog.

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  OCCUPIED: "bg-blue-100 text-blue-800",
  DIRTY: "bg-amber-100 text-amber-800",
  MAINTENANCE: "bg-red-100 text-red-800",
};

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [roomDialog, setRoomDialog] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomRecord | null>(null);
  const [roomForm, setRoomForm] = useState({ number: "", roomTypeId: "", floor: "" });
  const [savingRoom, setSavingRoom] = useState(false);

  const [typesDialog, setTypesDialog] = useState(false);
  const [typeForm, setTypeForm] = useState({ name: "", ratePerNight: "", capacity: "" });
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomsRes, typesRes] = await Promise.all([
        apiService.getRooms({ isActive: true }),
        apiService.getRoomTypes({}),
      ]);
      if (roomsRes.success && roomsRes.data) setRooms(roomsRes.data);
      if (typesRes.success && typesRes.data) setRoomTypes(typesRes.data);
    } catch {
      toast({ title: "Could not load rooms", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRooms = rooms.filter(
    (room) => statusFilter === "all" || room.status === statusFilter
  );

  const setStatus = async (room: RoomRecord, status: RoomStatus) => {
    setBusyId(room.id);
    try {
      const response = await apiService.updateRoomStatus(room.id, status);
      if (response.success) {
        toast({ title: `Room ${room.number} marked ${status}` });
        load();
      } else {
        toast({ title: (response as any)?.message || "Status change refused", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Status change refused", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const openRoomDialog = (room?: RoomRecord) => {
    if (room) {
      setEditingRoom(room);
      setRoomForm({
        number: room.number,
        roomTypeId: room.roomTypeId,
        floor: room.floor || "",
      });
    } else {
      setEditingRoom(null);
      setRoomForm({ number: "", roomTypeId: roomTypes.find((t) => t.isActive)?.id || "", floor: "" });
    }
    setRoomDialog(true);
  };

  const saveRoom = async () => {
    setSavingRoom(true);
    try {
      const payload = {
        number: roomForm.number.trim(),
        roomTypeId: roomForm.roomTypeId,
        floor: roomForm.floor.trim() || null,
      };
      const response = editingRoom
        ? await apiService.updateRoom(editingRoom.id, payload)
        : await apiService.createRoom(payload);
      if (response.success) {
        toast({ title: editingRoom ? "Room updated" : "Room created" });
        setRoomDialog(false);
        load();
      } else {
        toast({ title: (response as any)?.message || "Could not save the room", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Could not save the room", variant: "destructive" });
    } finally {
      setSavingRoom(false);
    }
  };

  const deactivateRoom = async (room: RoomRecord) => {
    setBusyId(room.id);
    try {
      const response = await apiService.deactivateRoom(room.id);
      if (response.success) {
        toast({ title: `Room ${room.number} deactivated` });
        load();
      } else {
        toast({ title: (response as any)?.message || "Could not deactivate", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Could not deactivate", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const saveType = async () => {
    setSavingType(true);
    try {
      const payload = {
        name: typeForm.name.trim(),
        ratePerNight: Number(typeForm.ratePerNight) || 0,
        capacity: typeForm.capacity ? Number(typeForm.capacity) : null,
      };
      const response = editingTypeId
        ? await apiService.updateRoomType(editingTypeId, payload)
        : await apiService.createRoomType(payload);
      if (response.success) {
        toast({ title: editingTypeId ? "Room type updated" : "Room type created" });
        setTypeForm({ name: "", ratePerNight: "", capacity: "" });
        setEditingTypeId(null);
        load();
      } else {
        toast({ title: (response as any)?.message || "Could not save the type", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Could not save the type", variant: "destructive" });
    } finally {
      setSavingType(false);
    }
  };

  const toggleTypeActive = async (type: RoomTypeRecord) => {
    try {
      const response = type.isActive
        ? await apiService.deactivateRoomType(type.id)
        : await apiService.updateRoomType(type.id, { isActive: true });
      if (response.success) load();
      else toast({ title: (response as any)?.message || "Could not change the type", variant: "destructive" });
    } catch (err: any) {
      toast({ title: err?.message || "Could not change the type", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BedDouble className="h-6 w-6" /> Rooms
          </h1>
          <p className="text-sm text-muted-foreground">
            The housekeeping board. Occupied rooms change only through check-in and check-out.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTypesDialog(true)}>
            <Settings2 className="h-4 w-4 mr-1" /> Room types
          </Button>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={() => openRoomDialog()}>
            <Plus className="h-4 w-4 mr-1" /> Add room
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {["all", "AVAILABLE", "OCCUPIED", "DIRTY", "MAINTENANCE"].map((status) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            onClick={() => setStatusFilter(status)}
          >
            {status === "all" ? "All" : status}
            {status !== "all" &&
              ` (${rooms.filter((r) => r.status === status).length})`}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visibleRooms.length === 0 ? (
        <div className="rounded-lg border p-10 text-center text-muted-foreground">
          No rooms yet. Add a room type first if you have not, then add your rooms.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleRooms.map((room) => (
            <div key={room.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xl font-bold">{room.number}</div>
                  <div className="text-sm text-muted-foreground">
                    {room.roomType?.name || "Room"}
                    {room.floor ? ` · Floor ${room.floor}` : ""}
                  </div>
                </div>
                <Badge className={STATUS_STYLES[room.status]}>{room.status}</Badge>
              </div>
              <div className="text-sm">{money(room.roomType?.ratePerNight)} / night</div>
              {room.status === "OCCUPIED" && room.folios?.[0] && (
                <div className="text-sm text-muted-foreground">
                  In house: {room.folios[0].guestName}
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1">
                {room.status === "DIRTY" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === room.id}
                    onClick={() => setStatus(room, "AVAILABLE")}
                  >
                    <Sparkles className="h-3 w-3 mr-1" /> Mark cleaned
                  </Button>
                )}
                {(room.status === "AVAILABLE" || room.status === "DIRTY") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === room.id}
                    onClick={() => setStatus(room, "MAINTENANCE")}
                  >
                    <Wrench className="h-3 w-3 mr-1" /> Maintenance
                  </Button>
                )}
                {room.status === "MAINTENANCE" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === room.id}
                    onClick={() => setStatus(room, "AVAILABLE")}
                  >
                    <Sparkles className="h-3 w-3 mr-1" /> Back in service
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openRoomDialog(room)}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === room.id || room.status === "OCCUPIED"}
                  onClick={() => deactivateRoom(room)}
                >
                  <Ban className="h-3 w-3 mr-1" /> Deactivate
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={roomDialog} onOpenChange={setRoomDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRoom ? "Edit room" : "Add room"}</DialogTitle>
            <DialogDescription>Door numbers are unique in the business.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Room number</Label>
              <Input
                value={roomForm.number}
                onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })}
                placeholder="101"
              />
            </div>
            <div>
              <Label>Room type</Label>
              <Select
                value={roomForm.roomTypeId}
                onValueChange={(v) => setRoomForm({ ...roomForm, roomTypeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a type" />
                </SelectTrigger>
                <SelectContent>
                  {roomTypes
                    .filter((t) => t.isActive || t.id === roomForm.roomTypeId)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {money(t.ratePerNight)}/night
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Floor (optional)</Label>
              <Input
                value={roomForm.floor}
                onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })}
                placeholder="1"
              />
            </div>
            <Button
              className="w-full"
              onClick={saveRoom}
              disabled={savingRoom || !roomForm.number.trim() || !roomForm.roomTypeId}
            >
              {savingRoom ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editingRoom ? "Save changes" : "Add room"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={typesDialog} onOpenChange={setTypesDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Room types</DialogTitle>
            <DialogDescription>
              The nightly rate is snapshotted onto the folio at check-in — changing a rate
              never reprices a guest already in-house.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {roomTypes.map((type) => (
              <div key={type.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div>
                  <span className="font-medium">{type.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {money(type.ratePerNight)}/night
                    {type.capacity ? ` · sleeps ${type.capacity}` : ""}
                    {` · ${type._count?.rooms || 0} room(s)`}
                  </span>
                  {!type.isActive && <Badge variant="outline" className="ml-2">inactive</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingTypeId(type.id);
                      setTypeForm({
                        name: type.name,
                        ratePerNight: String(type.ratePerNight),
                        capacity: type.capacity ? String(type.capacity) : "",
                      });
                    }}
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleTypeActive(type)}>
                    {type.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>
            ))}
            {roomTypes.length === 0 && (
              <p className="text-sm text-muted-foreground">No room types yet — create the first below.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div>
              <Label>Name</Label>
              <Input
                value={typeForm.name}
                onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                placeholder="Deluxe King"
              />
            </div>
            <div>
              <Label>Rate / night</Label>
              <Input
                type="number"
                min="0"
                value={typeForm.ratePerNight}
                onChange={(e) => setTypeForm({ ...typeForm, ratePerNight: e.target.value })}
                placeholder="8000"
              />
            </div>
            <div>
              <Label>Capacity</Label>
              <Input
                type="number"
                min="1"
                value={typeForm.capacity}
                onChange={(e) => setTypeForm({ ...typeForm, capacity: e.target.value })}
                placeholder="2"
              />
            </div>
          </div>
          <Button onClick={saveType} disabled={savingType || !typeForm.name.trim()}>
            {savingType ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {editingTypeId ? "Save type changes" : "Add room type"}
          </Button>
          {editingTypeId && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditingTypeId(null);
                setTypeForm({ name: "", ratePerNight: "", capacity: "" });
              }}
            >
              Cancel editing
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoomsPage;
