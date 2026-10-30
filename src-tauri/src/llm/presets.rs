//! 渠道预设：把「OpenCode Go / Zen」这类需要特定端点与会话头的服务收敛到一处。
//!
//! 预设只负责**补默认值**：运行期一律以 `ChannelConfig` 上的字段为准，
//! 用户手改过的值不会被预设覆盖（见 [`apply_to_channel`]）。
//! 前端通过 `llm_channel_presets` 命令读取同一份清单，桌面与移动端不再各抄一份 URL。

use serde::Serialize;

use super::registry::ChannelConfig;

/// 预设清单里的一项（序列化给前端做「添加渠道」的快捷入口）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPresetInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub models_url: &'static str,
    pub session_header: &'static str,
    /// 给用户看的一句话说明（为什么需要会话头 / 有什么限制）。
    pub note: &'static str,
}

pub const CHANNEL_PRESETS: &[ChannelPresetInfo] = &[
    ChannelPresetInfo {
        id: "opencode-go",
        name: "OpenCode Go",
        base_url: "https://opencode.ai/inference/go/openai/v1",
        models_url: "https://opencode.ai/inference/go/v1/models",
        session_header: "x-opencode-session",
        note: "订阅制。Go 端点要求每个请求带会话头（缺头直接 400），Marcel 会按会话自动注入；免费模型需 OpenCode 客户端，Marcel 无法调用。",
    },
    ChannelPresetInfo {
        id: "opencode-zen",
        name: "OpenCode Zen",
        base_url: "https://opencode.ai/inference/openai/v1",
        models_url: "https://opencode.ai/inference/v1/models",
        session_header: "x-opencode-session",
        note: "按量付费。当前不强制会话头，预设一并发送，避免日后收紧。",
    },
];

/// 按 id 找预设。
pub fn find(id: &str) -> Option<&'static ChannelPresetInfo> {
    let id = id.trim();
    CHANNEL_PRESETS.iter().find(|p| p.id == id)
}

/// 只给空字段补默认值（手改过的配置不会被悄悄改回去）。
pub fn apply_to_channel(channel: &mut ChannelConfig) {
    let Some(preset) = find(&channel.preset) else {
        return;
    };
    if channel.base_url.trim().is_empty() {
        channel.base_url = preset.base_url.to_string();
    }
    if channel.models_url.trim().is_empty() {
        channel.models_url = preset.models_url.to_string();
    }
    if channel.session_header.trim().is_empty() {
        channel.session_header = preset.session_header.to_string();
    }
}

/// 解析期兜底：旧配置里只有 `preset`、没展开字段时也能拿到正确端点与会话头。
pub fn effective_session_header(channel: &ChannelConfig) -> String {
    if !channel.session_header.trim().is_empty() {
        return channel.session_header.trim().to_string();
    }
    find(&channel.preset)
        .map(|p| p.session_header.to_string())
        .unwrap_or_default()
}

pub fn effective_models_url(channel: &ChannelConfig) -> Option<String> {
    let raw = if channel.models_url.trim().is_empty() {
        find(&channel.preset)
            .map(|p| p.models_url.to_string())
            .unwrap_or_default()
    } else {
        channel.models_url.trim().to_string()
    };
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::registry::ChannelConfig;

    #[test]
    fn preset_fills_only_empty_fields() {
        let mut c = ChannelConfig {
            preset: "opencode-go".into(),
            ..Default::default()
        };
        apply_to_channel(&mut c);
        assert_eq!(c.base_url, "https://opencode.ai/inference/go/openai/v1");
        assert_eq!(c.models_url, "https://opencode.ai/inference/go/v1/models");
        assert_eq!(c.session_header, "x-opencode-session");
    }

    #[test]
    fn user_overrides_survive_preset_apply() {
        let mut c = ChannelConfig {
            preset: "opencode-go".into(),
            base_url: "http://localhost:8080/v1".into(),
            session_header: "x-my-session".into(),
            ..Default::default()
        };
        apply_to_channel(&mut c);
        assert_eq!(c.base_url, "http://localhost:8080/v1");
        assert_eq!(c.session_header, "x-my-session");
    }

    #[test]
    fn effective_falls_back_to_preset_when_fields_empty() {
        let c = ChannelConfig {
            preset: "opencode-zen".into(),
            ..Default::default()
        };
        assert_eq!(effective_session_header(&c), "x-opencode-session");
        assert_eq!(
            effective_models_url(&c).as_deref(),
            Some("https://opencode.ai/inference/v1/models")
        );
    }

    #[test]
    fn custom_channel_has_no_session_header_and_default_models_path() {
        let c = ChannelConfig {
            base_url: "https://api.deepseek.com/v1".into(),
            ..Default::default()
        };
        assert_eq!(effective_session_header(&c), "");
        assert!(effective_models_url(&c).is_none());
    }
}
