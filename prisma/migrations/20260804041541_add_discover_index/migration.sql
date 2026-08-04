-- CreateIndex
CREATE INDEX "User_status_discoverable_trustScore_idx" ON "User"("status", "discoverable", "trustScore");
