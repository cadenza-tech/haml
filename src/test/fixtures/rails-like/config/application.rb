# frozen_string_literal: true

# Test fixture only. Its presence is the signal haml.snippets.rails "auto" looks for.
#
# A Gemfile.lock listing rails would work too, but must not be committed here: a lock naming
# haml_lint would flip every other integration test onto the bundler path. That is why the gem
# manifest lives in ../gem/ instead - bundle install regenerates a lock beside it, harmlessly.
