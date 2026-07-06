// swift-tools-version:5.7

import PackageDescription

let package = Package(
  name: "tauri-plugin-elector-push",
  platforms: [
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-elector-push",
      type: .static,
      targets: ["tauri-plugin-elector-push"]
    ),
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
  ],
  targets: [
    .target(
      name: "tauri-plugin-elector-push",
      dependencies: [
        .byName(name: "Tauri"),
      ],
      path: "Sources"
    ),
  ]
)
