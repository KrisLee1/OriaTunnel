use std::collections::VecDeque;

const WINDOW_MS: u64 = 10_000;
const WARMUP_MS: u64 = 2_000;
const STALL_MS: u64 = 5_000;

#[derive(Clone, Copy)]
struct Sample {
    ms: u64,
    bytes: u64,
}

#[derive(Default)]
pub(super) struct TransferTiming {
    previous: Option<Sample>,
    progress: VecDeque<Sample>,
}

impl TransferTiming {
    /// Instantaneous bytes/s and estimated seconds remaining for this copy attempt.
    pub fn sample(&mut self, ms: u64, bytes: u64, total: u64) -> (Option<u64>, Option<u64>) {
        let now = Sample { ms, bytes };
        let previous = self.previous.replace(now);
        let Some(previous) =
            previous.filter(|p| bytes >= p.bytes && ms > p.ms && ms - p.ms < STALL_MS)
        else {
            self.progress.clear();
            self.progress.push_back(now);
            return (None, None);
        };
        let delta = bytes - previous.bytes;
        let speed = (delta as f64 * 1000.0 / (ms - previous.ms) as f64).round() as u64;
        if delta > 0 {
            if self.progress.is_empty() {
                self.progress.push_back(previous);
            }
            self.progress.push_back(now);
            // Keep the sample at or just before the start of the window.
            while self.progress.get(1).is_some_and(|p| ms - p.ms >= WINDOW_MS) {
                self.progress.pop_front();
            }
        } else if self.progress.back().is_some_and(|p| ms - p.ms >= STALL_MS) {
            self.progress.clear();
        }
        // Between bursts the last measured rate still applies. Idle time enters
        // the average when the next bytes arrive. A lasting stall clears it.
        let eta = self
            .progress
            .front()
            .zip(self.progress.back())
            .and_then(|(first, last)| {
                let elapsed = last.ms - first.ms;
                let moved = last.bytes - first.bytes;
                if elapsed < WARMUP_MS || moved == 0 {
                    return None;
                }
                let remaining = total.saturating_sub(bytes) as u128;
                let seconds = (remaining * elapsed as u128).div_ceil(moved as u128 * 1000);
                Some(u64::try_from(seconds).unwrap_or(u64::MAX))
            });
        (Some(speed), eta)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alternating_rates_settle_to_the_batch_average_and_adapt_to_a_slowdown() {
        let mut timing = TransferTiming::default();
        let total = 2_000_000;
        let mut bytes = 0;
        timing.sample(0, bytes, total);
        for tick in 1..=60 {
            let delta = if tick % 2 == 0 { 9000 } else { 1000 };
            bytes += delta;
            let (speed, eta) = timing.sample(tick * 500, bytes, total);
            assert_eq!(speed, Some(delta * 2));
            if tick < 4 {
                assert_eq!(eta, None);
            }
            if tick >= 20 {
                assert_eq!(eta, Some((total - bytes).div_ceil(10_000)));
            }
        }
        for tick in 61..=80 {
            bytes += 1000;
            let (_, eta) = timing.sample(tick * 500, bytes, total);
            if tick == 80 {
                assert_eq!(eta, Some((total - bytes).div_ceil(2000)));
            }
        }
    }

    #[test]
    fn short_gaps_hold_the_estimate_and_a_stall_requires_fresh_progress() {
        let mut timing = TransferTiming::default();
        // The initial counter includes bytes committed before this attempt.
        for tick in 0..=4 {
            timing.sample(tick * 500, 4000 + tick * 100, 8000);
        }
        assert_eq!(timing.sample(2500, 4400, 8000), (Some(0), Some(18)));
        assert_eq!(timing.sample(3000, 4400, 8000), (Some(0), Some(18)));
        assert_eq!(timing.sample(3500, 4700, 8000), (Some(600), Some(17)));
        for tick in 8..17 {
            assert_eq!(timing.sample(tick * 500, 4700, 8000).1, Some(17));
        }
        assert_eq!(timing.sample(8500, 4700, 8000), (Some(0), None));
        for tick in 1..=4 {
            let (_, eta) = timing.sample(8500 + tick * 500, 4700 + tick * 50, 8000);
            assert_eq!(eta, (tick == 4).then_some(31));
        }
        assert_eq!(timing.sample(20_000, 7500, 8000), (None, None));
        assert_eq!(timing.sample(20_500, 3000, 8000), (None, None));
    }
}
