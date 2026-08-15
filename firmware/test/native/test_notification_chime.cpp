#include <assert.h>
#include <stdio.h>

#include "notification_chime.h"

int main() {
  assert(NotificationChimeVolume::DEFAULT_PERCENT == 60);
  assert(NotificationChimeVolume::MAX_PERCENT == 100);
  assert(NotificationChimeVolume::clampPercent(-1) == 0);
  assert(NotificationChimeVolume::clampPercent(60) == 60);
  assert(NotificationChimeVolume::clampPercent(101) == 100);

  NotificationChimeQueue queue;

  assert(queue.pendingCount() == 0);
  assert(!queue.messageReceived(nullptr));
  assert(!queue.messageReceived(""));
  assert(!queue.takeIfIdle(true));

  assert(queue.messageReceived("message-one"));
  assert(!queue.messageReceived("message-one"));
  assert(queue.messageReceived("message-two"));
  assert(queue.pendingCount() == 2);
  assert(!queue.takeIfIdle(true));
  assert(queue.pendingCount() == 2);

  assert(queue.takeIfIdle(false));
  assert(queue.pendingCount() == 1);
  assert(queue.takeIfIdle(false));
  assert(!queue.takeIfIdle(false));
  assert(!queue.messageReceived("message-one"));

  for (unsigned int index = 0; index < 20; index++) {
    char messageId[32];
    snprintf(messageId, sizeof(messageId), "burst-%u", index);
    queue.messageReceived(messageId);
  }
  assert(queue.pendingCount() == 20);
}
