//! One limiter for the whole app process, so every window shares IGDB's
//! budget: at most `per_second` request starts in any rolling second, at most
//! `concurrency` open requests, and a shared pause after a 429.
//!
//! Uses tokio's clock, so tests run on a paused clock.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;

const WINDOW: Duration = Duration::from_secs(1);

pub struct Limiter {
    per_second: usize,
    concurrency: Arc<Semaphore>,
    /// Start times in the current window. The async mutex is FIFO, so waiters
    /// are served in arrival order.
    starts: Mutex<VecDeque<Instant>>,
    paused_until: std::sync::Mutex<Option<Instant>>,
}

impl Limiter {
    pub fn new(per_second: usize, concurrency: usize) -> Self {
        Self {
            per_second: per_second.max(1),
            concurrency: Arc::new(Semaphore::new(concurrency.max(1))),
            starts: Mutex::new(VecDeque::new()),
            paused_until: std::sync::Mutex::new(None),
        }
    }

    /// Wait for a concurrency slot and a rate slot. Hold the permit for the
    /// duration of one HTTP attempt.
    pub async fn acquire(&self) -> OwnedSemaphorePermit {
        // The semaphore is never closed, so this cannot fail.
        let permit = self
            .concurrency
            .clone()
            .acquire_owned()
            .await
            .expect("IGDB limiter semaphore closed");
        self.take_start().await;
        permit
    }

    async fn take_start(&self) {
        let mut starts = self.starts.lock().await;
        loop {
            let now = Instant::now();
            let paused = *self.paused_until.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(until) = paused {
                if until > now {
                    tokio::time::sleep_until(until).await;
                    continue;
                }
            }
            while starts
                .front()
                .is_some_and(|t| now.duration_since(*t) >= WINDOW)
            {
                starts.pop_front();
            }
            if starts.len() < self.per_second {
                starts.push_back(now);
                return;
            }
            let oldest = *starts.front().expect("window is full");
            tokio::time::sleep_until(oldest + WINDOW).await;
        }
    }

    /// Hold every new start until `duration` from now (after a 429).
    pub fn pause_for(&self, duration: Duration) {
        let until = Instant::now() + duration;
        let mut paused = self.paused_until.lock().unwrap_or_else(|e| e.into_inner());
        if paused.is_none_or(|current| current < until) {
            *paused = Some(until);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test(start_paused = true)]
    async fn never_more_than_four_starts_per_second() {
        let limiter = Arc::new(Limiter::new(4, 8));
        let starts = Arc::new(std::sync::Mutex::new(Vec::new()));
        let origin = Instant::now();
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let limiter = limiter.clone();
            let starts = starts.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = limiter.acquire().await;
                starts.lock().unwrap().push(Instant::now() - origin);
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        let mut starts = starts.lock().unwrap().clone();
        starts.sort();
        assert_eq!(starts.len(), 20);
        for (i, start) in starts.iter().enumerate() {
            let in_window = starts[i..]
                .iter()
                .take_while(|t| **t - *start < WINDOW)
                .count();
            assert!(in_window <= 4, "{in_window} starts within 1 s of {start:?}");
        }
        // 20 starts at 4/s need at least 4 full seconds.
        assert!(*starts.last().unwrap() >= Duration::from_secs(4));
    }

    #[tokio::test(start_paused = true)]
    async fn concurrency_is_capped() {
        let limiter = Arc::new(Limiter::new(100, 3));
        let open = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..12 {
            let (limiter, open, peak) = (limiter.clone(), open.clone(), peak.clone());
            tasks.push(tokio::spawn(async move {
                let _permit = limiter.acquire().await;
                let now = open.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(500)).await;
                open.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn pause_holds_every_start() {
        let limiter = Limiter::new(4, 4);
        let origin = Instant::now();
        limiter.pause_for(Duration::from_millis(1200));
        let _permit = limiter.acquire().await;
        assert!(Instant::now() - origin >= Duration::from_millis(1200));
        // A shorter pause never shortens a longer one.
        limiter.pause_for(Duration::from_secs(3));
        limiter.pause_for(Duration::from_millis(10));
        let before = Instant::now();
        drop(_permit);
        let _again = limiter.acquire().await;
        assert!(Instant::now() - before >= Duration::from_secs(3));
    }
}
