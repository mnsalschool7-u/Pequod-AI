import AVFoundation
import CoreGraphics
import Foundation

struct Config {
    let source: URL
    let output: URL
    let preview: URL
    let targetSize = CGSize(width: 1080, height: 1920)
    let backgroundColor = CGColor(red: 0.011, green: 0.024, blue: 0.043, alpha: 1.0)
}

func die(_ message: String) -> Never {
    fputs("Error: \(message)\n", stderr)
    exit(1)
}

func removeIfExists(_ url: URL) {
    if FileManager.default.fileExists(atPath: url.path) {
        try? FileManager.default.removeItem(at: url)
    }
}

func naturalPresentationSize(for track: AVAssetTrack) -> CGSize {
    let size = track.naturalSize.applying(track.preferredTransform)
    return CGSize(width: abs(size.width), height: abs(size.height))
}

func centeredTransform(sourceSize: CGSize, targetSize: CGSize, scale: CGFloat, yOffset: CGFloat) -> CGAffineTransform {
    let scaledWidth = sourceSize.width * scale
    let scaledHeight = sourceSize.height * scale
    let tx = (targetSize.width - scaledWidth) / 2
    let ty = (targetSize.height - scaledHeight) / 2 + yOffset
    return CGAffineTransform(translationX: tx, y: ty).scaledBy(x: scale, y: scale)
}

func export(asset: AVURLAsset, videoTrack: AVAssetTrack, output: URL, targetSize: CGSize, backgroundColor: CGColor, duration: CMTime? = nil) async throws {
    let composition = AVMutableComposition()

    guard let compositionVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        die("Could not create video composition track")
    }

    let fullRange = CMTimeRange(start: .zero, duration: duration ?? asset.duration)
    try compositionVideoTrack.insertTimeRange(fullRange, of: videoTrack, at: .zero)
    compositionVideoTrack.preferredTransform = .identity

    if let audioTrack = try await asset.loadTracks(withMediaType: .audio).first,
       let compositionAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        try compositionAudioTrack.insertTimeRange(fullRange, of: audioTrack, at: .zero)
    }

    let sourceSize = naturalPresentationSize(for: videoTrack)
    let nominalFrameRate = try await videoTrack.load(.nominalFrameRate)
    let fps = nominalFrameRate > 0 ? nominalFrameRate : 30

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: fullRange.duration)
    instruction.backgroundColor = backgroundColor

    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)

    // 0.44x trims the source's side dead space while preserving the central app surface.
    // This keeps the demo readable without cutting important text off the sides.
    var transform = videoTrack.preferredTransform
    transform = transform.concatenating(centeredTransform(sourceSize: sourceSize, targetSize: targetSize, scale: 0.44, yOffset: 0))
    layerInstruction.setTransform(transform, at: .zero)

    instruction.layerInstructions = [layerInstruction]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = targetSize
    videoComposition.frameDuration = CMTime(value: 1000, timescale: CMTimeScale(round(fps * 1000)))
    videoComposition.instructions = [instruction]
    videoComposition.sourceTrackIDForFrameTiming = compositionVideoTrack.trackID
    videoComposition.renderScale = 1.0

    removeIfExists(output)
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
        die("Could not create export session")
    }

    exporter.outputURL = output
    exporter.outputFileType = .mp4
    exporter.videoComposition = videoComposition
    exporter.shouldOptimizeForNetworkUse = true

    await exporter.export()

    if exporter.status != .completed {
        throw exporter.error ?? NSError(domain: "ReelExport", code: Int(exporter.status.rawValue), userInfo: [NSLocalizedDescriptionKey: "Export failed with status \(exporter.status.rawValue)"])
    }
}

func main() async {
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    let config = Config(
        source: URL(fileURLWithPath: "/Users/manhasaleha/Downloads/Llama index demo.mov"),
        output: cwd.appendingPathComponent("pequod-llamaparse-reel-1080x1920.mp4"),
        preview: cwd.appendingPathComponent("pequod-llamaparse-reel-preview-10s.mp4")
    )

    let asset = AVURLAsset(url: config.source)
    do {
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let videoTrack = tracks.first else {
            die("No video track found")
        }

        let sourceSize = naturalPresentationSize(for: videoTrack)
        let duration = try await asset.load(.duration)
        let nominalFrameRate = try await videoTrack.load(.nominalFrameRate)
        print("Source: \(Int(sourceSize.width))x\(Int(sourceSize.height)), duration \(CMTimeGetSeconds(duration))s, fps \(nominalFrameRate)")

        try await export(asset: asset, videoTrack: videoTrack, output: config.output, targetSize: config.targetSize, backgroundColor: config.backgroundColor)

        let previewDuration = CMTimeMinimum(duration, CMTime(seconds: 10, preferredTimescale: duration.timescale == 0 ? 600 : duration.timescale))
        try await export(asset: asset, videoTrack: videoTrack, output: config.preview, targetSize: config.targetSize, backgroundColor: config.backgroundColor, duration: previewDuration)

        print("Final: \(config.output.path)")
        print("Preview: \(config.preview.path)")
    } catch {
        die(error.localizedDescription)
    }
}

await main()
