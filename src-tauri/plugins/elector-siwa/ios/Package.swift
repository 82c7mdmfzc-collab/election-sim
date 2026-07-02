// swift-tools-version:5.7

import PackageDescription

let package = Package(
  name: "tauri-plugin-elector-siwa",
  platforms: [
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-elector-siwa",
      type: .static,
      targets: ["tauri-plugin-elector-siwa"]
    ),
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
  ],
  targets: [
    .target(
      name: "tauri-plugin-elector-siwa",
      dependencies: [
        .byName(name: "Tauri"),
      ],
      path: "Sources",
      linkerSettings: [
        .linkedFramework("AuthenticationServices"),
      ]
    ),
  ]
)
