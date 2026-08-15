#pragma once

#include <stdint.h>
#include <string.h>

namespace NotificationChimeVolume {

constexpr uint8_t DEFAULT_PERCENT = 60;
constexpr uint8_t MAX_PERCENT = 100;

inline uint8_t clampPercent(int requested) {
  if (requested < 0) return 0;
  if (requested > MAX_PERCENT) return MAX_PERCENT;
  return static_cast<uint8_t>(requested);
}

}  // namespace NotificationChimeVolume

class NotificationChimeQueue {
 public:
  bool messageReceived(const char *messageId) {
    if (messageId == nullptr
        || messageId[0] == '\0'
        || wasRecentlySeen(messageId)) {
      return false;
    }
    remember(messageId);
    if (pendingCount_ < UINT16_MAX) pendingCount_++;
    return true;
  }

  bool takeIfIdle(bool shouldDefer) {
    if (shouldDefer || pendingCount_ == 0) return false;
    pendingCount_--;
    return true;
  }

  uint16_t pendingCount() const { return pendingCount_; }

 private:
  static constexpr uint8_t RECENT_MESSAGE_CAPACITY = 16;
  static constexpr size_t MESSAGE_ID_CAPACITY = 32;

  bool wasRecentlySeen(const char *messageId) const {
    for (uint8_t index = 0; index < RECENT_MESSAGE_CAPACITY; index++) {
      if (strncmp(
        recentMessageIds_[index],
        messageId,
        MESSAGE_ID_CAPACITY
      ) == 0) {
        return true;
      }
    }
    return false;
  }

  void remember(const char *messageId) {
    strncpy(
      recentMessageIds_[nextRecentIndex_],
      messageId,
      MESSAGE_ID_CAPACITY - 1
    );
    recentMessageIds_[nextRecentIndex_][MESSAGE_ID_CAPACITY - 1] = '\0';
    nextRecentIndex_ = static_cast<uint8_t>(
      (nextRecentIndex_ + 1) % RECENT_MESSAGE_CAPACITY
    );
  }

  char recentMessageIds_[RECENT_MESSAGE_CAPACITY][MESSAGE_ID_CAPACITY] = {};
  uint8_t nextRecentIndex_ = 0;
  uint16_t pendingCount_ = 0;
};
