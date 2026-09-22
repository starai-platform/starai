package handler

import (
	"context"
	"errors"
	"sync/atomic"
)

type creativeAgentRecoveryKey struct{}

// One additional model call across fallback, format and content repair. The
// provider service still owns its own transport/route retry policy.
func creativeAgentRecoveryContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, creativeAgentRecoveryKey{}, &atomic.Bool{})
}

func creativeAgentTakeRecovery(ctx context.Context) bool {
	if ctx.Err() != nil {
		return false
	}
	used, _ := ctx.Value(creativeAgentRecoveryKey{}).(*atomic.Bool)
	return used == nil || used.CompareAndSwap(false, true)
}

var errCreativeAgentRecoveryUsed = errors.New("本轮自动恢复次数已用完，保留已有内容")
