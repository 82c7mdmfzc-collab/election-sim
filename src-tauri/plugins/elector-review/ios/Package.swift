// swift-tools-version:5.7

import PackageDescription

let package = Package(
  name: "tauri-plugin-elector-review",
  platforms: [
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-elector-review",
      type: .static,
      targets: ["tauri-plugin-elector-review"]
    ),
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
  ],
  targets: [
    .target(
      name: "tauri-plugin-elector-review",
      dependencies: [
        .byName(name: "Tauri"),
      ],
      path: "Sources",
      linkerSettings: [
        .linkedFramework("StoreKit"),
      ]
    ),
  ]
)
