# The plugin class is looked up reflectively by name from Rust
# (register_android_plugin) — keep it and its @Command methods intact when the
# consuming app minifies. Firebase ships its own rules in its AAR.
-keep class com.playelector.push.** { *; }
