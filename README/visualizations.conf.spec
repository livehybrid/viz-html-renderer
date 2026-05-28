# visualizations.conf.spec
#
# Spec for the html_renderer visualization. Mirrors the keys read by the
# Dashboard Studio component (HtmlRenderer.jsx) and the Classic AMD shim
# (visualization_source_legacy_amd.js).

[html_renderer]
label = <string>
* Display name shown in the visualization picker.

description = <string>
* Short description shown alongside the viz.

search_fragment = <string>
* Seed SPL used when the user inserts the viz from the visualization picker.

default_height = <integer>
* Default panel height in pixels.

allow_user_selection = <boolean>
* Whether end-users can choose this viz from the picker.

# Property namespace: display.visualizations.custom.viz-html-renderer.html_renderer.*

htmlTemplate = <string>
* HTML markup rendered inside the panel. Supports {{field_name}} token
  interpolation from the first row of the primary data source. The container
  exposes the CSS variables --text, --bg and --accent.

allowScripts = <boolean>
* If true, <script> tags and on* event-handler attributes are preserved.
* DANGEROUS. Default: false.

theme = <auto|light|dark>
* Controls the palette assigned to the --text / --bg / --accent CSS variables
  exposed to the author's HTML. Default: auto.
