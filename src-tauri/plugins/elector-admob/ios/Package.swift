// swift-tools-version:5.7

import PackageDescription

let package = Package(
  name: "tauri-plugin-elector-admob",
  platforms: [
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-elector-admob",
      type: .static,
      targets: ["tauri-plugin-elector-admob"]
    ),
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
    .package(
      url: "https://github.com/googleads/swift-package-manager-google-mobile-ads.git",
      from: "12.0.0"
    ),
  ],
  targets: [
    .target(
      name: "tauri-plugin-elector-admob",
      dependencies: [
        .byName(name: "Tauri"),
        .product(name: "GoogleMobileAds", package: "swift-package-manager-google-mobile-ads"),
      ],
      path: "Sources"
    ),
  ]
)
