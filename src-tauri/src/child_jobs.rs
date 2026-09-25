//! Windows Job Object safety net for Nexa-spawned external mpv processes.
//!
//! Explicit cleanup (`thumbs::drop_shadow`, `dvr::finalize`, the shutdown
//! path in `lib.rs`) is the primary mechanism and runs first. This module is
//! only the backstop: every child assigned here is placed in a single job
//! object created once per Nexa process with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
//! so if Nexa's own process ever disappears without running that cleanup —
//! crash, force-kill, an exit path that misses it — Windows tears the child
//! down with it.
//!
//! The job is per-process, so it never touches a second Nexa instance or an
//! mpv the user launched by hand: neither is ever assigned to it.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// `HANDLE` is a plain kernel handle with no thread affinity; it is only
    /// ever read here, never mutated, so sharing it across threads is safe.
    struct JobHandle(HANDLE);
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    static JOB: OnceLock<Option<JobHandle>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        JOB.get_or_init(create_job).as_ref().map(|j| j.0)
    }

    fn create_job() -> Option<JobHandle> {
        unsafe {
            let handle = match CreateJobObjectW(None, PCWSTR::null()) {
                Ok(h) => h,
                Err(error) => {
                    eprintln!("[child-jobs] CreateJobObjectW failed: {error:?}");
                    return None;
                }
            };
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if let Err(error) = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) {
                eprintln!("[child-jobs] SetInformationJobObject failed: {error:?}");
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                return None;
            }
            Some(JobHandle(handle))
        }
    }

    /// Assign a freshly spawned child to Nexa's kill-on-close job object.
    /// Best-effort: on failure the child simply falls back to relying on
    /// explicit cleanup alone, exactly as it did before this module existed.
    pub fn adopt(child: &tokio::process::Child) {
        let Some(job) = job() else { return };
        let Some(raw) = child.raw_handle() else { return };
        let handle = HANDLE(raw);
        unsafe {
            if let Err(error) = AssignProcessToJobObject(job, handle) {
                eprintln!("[child-jobs] AssignProcessToJobObject failed: {error:?}");
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[tokio::test]
        async fn adopted_child_is_in_the_job() {
            use windows::Win32::System::JobObjects::IsProcessInJob;

            let child = tokio::process::Command::new("cmd")
                .args(["/C", "timeout", "/T", "30"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .expect("spawn cmd");

            adopt(&child);

            let raw = child.raw_handle().expect("child still running");
            let handle = HANDLE(raw);
            let job = job().expect("job object created");
            let mut in_job = windows::core::BOOL(0);
            unsafe {
                IsProcessInJob(handle, Some(job), &mut in_job)
                    .expect("IsProcessInJob succeeds");
            }
            assert!(in_job.as_bool(), "child was not assigned to the job object");

            drop(child);
        }
    }
}

#[cfg(windows)]
pub use imp::adopt;

#[cfg(not(windows))]
pub fn adopt(_child: &tokio::process::Child) {}
