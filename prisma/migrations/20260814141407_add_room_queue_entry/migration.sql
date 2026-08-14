-- CreateTable
CREATE TABLE "room_queue_entries" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_queue_entries_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "room_queue_entries" ADD CONSTRAINT "room_queue_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_queue_entries" ADD CONSTRAINT "room_queue_entries_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_queue_entries" ADD CONSTRAINT "room_queue_entries_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
