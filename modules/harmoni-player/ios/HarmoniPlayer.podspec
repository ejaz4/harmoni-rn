require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HarmoniPlayer'
  s.version        = package['version']
  s.summary        = 'Playback, session and downloads for Harmoni'
  s.description    = 'Playback, session and downloads for Harmoni'
  s.license        = 'UNLICENSED'
  s.author         = 'Harmoni'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
