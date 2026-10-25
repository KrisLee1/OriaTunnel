//! Test-only POSIX shell. Production never launches local config/service commands.
pub fn command() -> tokio::process::Command {
    #[cfg(unix)]
    let path = std::path::PathBuf::from("/bin/sh");
    #[cfg(windows)]
    let path = {
        static SHELL: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
        SHELL
            .get_or_init(|| {
                std::env::var_os("ORIATUNNEL_TEST_SH")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| {
                        let mut git = std::process::Command::new("git");
                        use std::os::windows::process::CommandExt;
                        let result = git
                            .args(["--exec-path"])
                            .creation_flags(0x08000000)
                            .output()
                            .expect("POSIX fixtures require Git for Windows or ORIATUNNEL_TEST_SH");
                        assert!(result.status.success());
                        let core = std::path::PathBuf::from(
                            String::from_utf8(result.stdout).unwrap().trim(),
                        );
                        let path = core.join("../../../bin/sh.exe");
                        assert!(
                            path.is_file(),
                            "Set ORIATUNNEL_TEST_SH to Git for Windows sh.exe"
                        );
                        path
                    })
            })
            .clone()
    };
    let mut command = tokio::process::Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    // MSYS understands this POSIX path and resolves only bundled fixture tools.
    command.env(
        "PATH",
        if cfg!(windows) {
            "/mingw64/bin:/clangarm64/bin:/usr/bin:/bin"
        } else {
            "/usr/bin:/bin"
        },
    );
    command
}
