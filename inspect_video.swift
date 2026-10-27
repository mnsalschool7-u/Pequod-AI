import AVFoundation
import AppKit
import Foundation

func die(_ message: String) -> Never {
    fputs("Error: \(message)\n", stderr)
    exit(1)
}

func presentationSize(_ track: AVAssetTrack) -> CGSize {
    let transformed = track.naturalSize.applying(track.preferredTransform)
    return CGSize(width: abs(transformed.width), height: abs(transformed.height))
}

func writeThumbnail(asset: AVURLAsset, at seconds: Double, to url: URL) throws {
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 540, height: 960)
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        die("Could not encode thumbnail")
    }
    try data.write(to: url)
}

let args = CommandLine.arguments.dropFirst()
guard let first = args.first else {
    die("Usage: swift inspect_video.swift <video>")
}

let input = URL(fileURLWithPath: first)
let asset = AVURLAsset(url: input)
guard let videoTrack = asset.tracks(withMediaType: .video).first else {
    die("No video track found")
}

let size = presentationSize(videoTrack)
let duration = CMTimeGetSeconds(asset.duration)
let codecs = videoTrack.formatDescriptions.map { CMFormatDescriptionGetMediaSubType($0 as! CMFormatDescription) }
let codecStrings = codecs.map { code -> String in
    let bytes: [UInt8] = [
        UInt8((code >> 24) & 0xff),
        UInt8((code >> 16) & 0xff),
        UInt8((code >> 8) & 0xff),
        UInt8(code & 0xff)
    ]
    return String(bytes: bytes, encoding: .macOSRoman) ?? "\(code)"
}
let hasAudio = !asset.tracks(withMediaType: .audio).isEmpty

print("path=\(input.path)")
print("resolution=\(Int(size.width))x\(Int(size.height))")
print("duration=\(String(format: "%.3f", duration))")
print("fps=\(String(format: "%.5f", videoTrack.nominalFrameRate))")
print("videoCodecs=\(codecStrings.joined(separator: ","))")
print("hasAudio=\(hasAudio)")

let base = input.deletingPathExtension().lastPathComponent
let outDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
for second in [1.0, min(max(duration / 2, 1.0), duration - 1.0), max(duration - 2.0, 1.0)] {
    let name = "\(base)-thumb-\(Int(second.rounded())).png"
    let url = outDir.appendingPathComponent(name)
    try writeThumbnail(asset: asset, at: second, to: url)
    print("thumbnail=\(url.path)")
}
