use tauri::State;

use crate::error::AppError;
use crate::plugins::fs::{resolve_read_path, resolve_write_path};
use crate::AppState;

#[tauri::command]
pub async fn plugin_fs_read(
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, AppError> {
    let config_dir = state.config_dir.clone();
    let file_path = resolve_read_path(&config_dir, &plugin_id, &path)?;
    // 不存在 = 空内容（与 `kind=local` 的 fs.read 保持一致）
    match std::fs::read_to_string(&file_path) {
        Ok(c) => Ok(c),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AppError::Other(format!("failed to read file: {}", e))),
    }
}

#[tauri::command]
pub async fn plugin_fs_write(
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let config_dir = state.config_dir.clone();
    let file_path = resolve_write_path(&config_dir, &plugin_id, &path)?;
    std::fs::write(&file_path, content)
        .map_err(|e| AppError::Other(format!("failed to write file: {}", e)))
}
