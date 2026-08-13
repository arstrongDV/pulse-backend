-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('STOPPED', 'PLAYING', 'PAUSED');

-- CreateTable
CREATE TABLE "playback_states" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "track_id" TEXT,
    "status" "PlaybackStatus" NOT NULL DEFAULT 'STOPPED',
    "position_ms" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playback_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playback_states_room_id_key" ON "playback_states"("room_id");

-- AddForeignKey
ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
