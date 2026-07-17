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
      exact: "12.14.0"
    ),
    .package(
      url: "https://github.com/googleads/swift-package-manager-google-user-messaging-platform.git",
      exact: "3.1.0"
    ),
  ],
  targets: [
    .target(
      name: "tauri-plugin-elector-admob",
      dependencies: [
        .byName(name: "Tauri"),
        .product(name: "GoogleMobileAds", package: "swift-package-manager-google-mobile-ads"),
        .product(
          name: "GoogleUserMessagingPlatform",
          package: "swift-package-manager-google-user-messaging-platform"
        ),
      ],
      path: "Sources"
    ),
  ]
)
